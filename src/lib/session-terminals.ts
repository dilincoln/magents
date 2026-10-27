import {
	type EmbeddedTerminalDataSource,
	EmbeddedTerminalRenderable,
	type RenderContext,
	type Selection,
} from "@opentui/core";
import { create } from "zustand";
import { startTerminal as postTerminal } from "../../client/start-terminal";
import {
	CLOSE_REMOVED,
	type SessionFrame,
} from "../../daemon/lib/attach-frames";
import { type Attachment, attachTerminal } from "./attach-terminal";
import { copyText } from "./copy";
import { createDecscusrWatch } from "./decscusr";
import { createOsc52Scanner } from "./osc52";
import { literalKey, repairKey } from "./repair-key";

/**
 * Every session's terminal, kept outside React.
 *
 * A pane is a view, and the registry is what makes the view disposable:
 * mounting attaches a renderable to the visible box, unmounting detaches it,
 * and neither touches what is running. That much is unchanged and is still the
 * reason looking at another session does not end the one you were on.
 *
 * What changed is what is being viewed. The process is not ours any more. A PTY
 * child dies when the last master fd closes — measured, and indistinguishable
 * from the child's side whether the holder exited, was SIGTERMed or was
 * SIGKILLed — and that fd now lives in the daemon, so an agent outlives this
 * whole program. What this file caches on the daemon path is therefore the
 * *screen*: an emulator, a socket, and how far into that socket's byte stream
 * the emulator has been fed. Reattaching resumes from the offset rather than
 * replaying from nothing, which is what keeps switching panes free and keeps a
 * lossy replay to the one path that has to be lossy — coming back to a session
 * this process has never seen.
 *
 * There was briefly a `--no-daemon-pty` beside this that kept the old
 * TUI-owned implementation whole, as an escape hatch on the largest change this
 * project has made to how a session stays alive. It is gone, and it is worth
 * saying why rather than letting the absence read as confidence. It broke twice
 * in one afternoon, in opposite directions: first the daemon spawned on
 * `POST /sessions` regardless, so the flag put two agents on one conversation;
 * then `start: false` fixed that and put none on it, because for claude the
 * skipped command is the only one that *creates* the conversation and the pane
 * went on to resume something that had never existed. Keeping it also meant
 * keeping an argv on the wire, a command in the store and a ref in the pane —
 * the whole shape this change exists to delete. A hatch that does not open is
 * worse than a wall: it invites being reached for at the one moment it fails.
 */

/** How much of a conversation stays scrollable behind the visible rows. */
const SCROLLBACK = 50_000;

/**
 * The emulator's renderable, with one opinion added: an unstyled cursor is a
 * bar, not a block.
 *
 * Outside magents, claude's input shows the thin `|` of the terminal's own
 * default cursor — claude never sends DECSCUSR, it inherits. Inside, the
 * emulator resolves "never asked" to `block` and the pane relays that to the
 * real cursor, so the same claude grew a filled rectangle. The emulator's
 * answer cannot tell "never asked" from "asked for a block" — both come back
 * `block` — which is why `childStyled` is fed by a watcher on the byte stream
 * (see `decscusr.ts`) rather than read off the emulator: the moment the
 * program inside chooses any shape, including a block, its choice is relayed
 * untouched, and vim's block is vim's.
 */
class PaneTerminalRenderable extends EmbeddedTerminalRenderable {
	/** whether the program inside ever sent DECSCUSR on this stream */
	childStyled = false;

	/*
	 * A selection with no extent is not painted. The renderer opens one on the
	 * mouse-down — anchor and focus on the same cell — and the emulator paints
	 * exactly that cell, so every click flashed a one-character highlight for
	 * as long as the button was held. The mouse-up clears it (see
	 * `use-copy-on-select`), but a flash cleared afterwards is still a flash.
	 * Zero width is handed on as "no selection"; the first movement past the
	 * cell arrives as a real range and paints as usual.
	 */
	override onSelectionChanged(selection: Selection | null): boolean {
		const zero =
			selection !== null &&
			selection.anchor.x === selection.focus.x &&
			selection.anchor.y === selection.focus.y;
		return super.onSelectionChanged(zero ? null : selection);
	}

	protected override renderSelf(
		buffer: Parameters<EmbeddedTerminalRenderable["renderSelf"]>[0],
	): void {
		// position, visibility and the child's own style, exactly as upstream
		super.renderSelf(buffer);

		// then the default, overridden only while nobody inside has spoken —
		// after `super`, so a real DECSCUSR always has the last word next frame
		if (!this.childStyled && this.focused) {
			this._ctx.setCursorStyle({ style: "line", blinking: true });
		}
	}
}

const build = (ctx: RenderContext): PaneTerminalRenderable => {
	const renderable = new PaneTerminalRenderable(ctx, {
		width: "100%",
		height: "100%",
		maxScrollback: SCROLLBACK,
		selectable: true,
	});

	/*
	 * Every key goes to the agent, and these are the ones that have to be handed
	 * over by hand — see `repairKey` for what the emulator gets wrong and
	 * `literalKey` for the one key it has no name for at all.
	 *
	 * `onKeyDown` is the hook because of where it sits: the renderer calls it
	 * first and only calls the emulator's own `handleKeyPress` if nothing
	 * prevented the default. So this is not a second handler racing the built-in
	 * one, it is the same handler called with a key it can encode, and the
	 * `preventDefault` is what stops the key being encoded twice.
	 */
	renderable.onKeyDown = (key) => {
		/*
		 * One key does not go through the emulator at all, and the detour is the
		 * point: ⌃enter arrives from a terminal without kitty disambiguation as a
		 * bare 0x0A, which is not a physical key and which `encodeKey` therefore
		 * answers with nothing. See `literalKey` for the measurement, including
		 * why the byte is forwarded rather than re-keyed into a ⌃enter the
		 * emulator *can* spell.
		 *
		 * Through `onData` because that is the socket: the emulator's own `send`
		 * ends up there too, and going by the same door means a replay in flight
		 * still holds the input path off — the one moment nothing may be typed
		 * into the agent.
		 */
		const literal = literalKey(key);
		if (literal) {
			renderable.onData?.(literal, "input");
			key.preventDefault();
			return;
		}

		const repaired = repairKey(key);
		if (!repaired) return;

		renderable.handleKeyPress(repaired);
		key.preventDefault();
	};

	return renderable;
};

/**
 * The terminal for a session: an emulator, and a socket to the process.
 *
 * No command is passed in and none crosses the socket in either direction — the
 * daemon holds the adapter that knows what to run, and a session id is the whole
 * of what this side has to say. Returning to a session that already has a
 * terminal reconnects nothing: the entry is the screen, and the screen stayed.
 */
export function terminalFor(
	ctx: RenderContext,
	sessionId: string,
): EmbeddedTerminalRenderable {
	return attachedFor(ctx, sessionId);
}

/** A pane is showing this session: it votes on the size and takes the token. */
export function paneMounted(sessionId: string): void {
	const entry = attached.get(sessionId);
	if (!entry) return;

	// Read off the renderable rather than passed in, because the caller does not
	// know either: a pane that has just been added to a host has no layout yet
	// and `onTerminalResize` is what will say. On a *re*mount the renderable
	// still carries the size it had, and that is the vote to cast now — yoga
	// does not call back for a size that did not change, so waiting for the
	// resize would leave this client withdrawn from the vote forever.
	const { width, height } = entry.renderable;
	if (width <= 0 || height <= 0) return;

	entry.viewport = { cols: width, rows: height };
	entry.attachment.size(width, height);
}

/** Nobody is showing it here any more; the size vote goes with the pane. */
export function paneUnmounted(sessionId: string): void {
	const entry = attached.get(sessionId);
	if (!entry) return;

	entry.viewport = null;
	entry.attachment.size(0, 0);
}

/**
 * Put a process back on a session, because a person asked for one.
 *
 * Attaching never starts anything, and this is the other half of that rule
 * rather than an exception to it. The pane used to POST by itself whenever the
 * daemon answered `never-started`, on the reading that a session which has
 * never run has nothing to lose. That is not what the answer means: a daemon
 * that has just restarted has an empty registry and says `never-started` about
 * every session in it, so one restart re-ran the provider's resume command for
 * every session a pane had ever been opened on this run — mounted or not,
 * including the ones stopped on purpose — and the user's first sign of it was
 * a roster full of agents nobody asked for. A socket reconnecting is not
 * somebody asking.
 *
 * Answers whether there was anything to start, which is what the screen needs
 * to know before it takes the key away from a running agent.
 */
export function startTerminal(sessionId: string): boolean {
	const entry = attached.get(sessionId);
	if (!entry) return false;
	if (!startable(useAttachStatus.getState().status[sessionId])) return false;

	// Said before the daemon says it, because a key with no visible answer reads
	// as a key that did nothing — and codex's settling time is two seconds long.
	note(sessionId, { state: "starting", error: null });

	postTerminal(sessionId).catch((cause: unknown) => {
		note(sessionId, {
			error: cause instanceof Error ? cause.message : String(cause),
		});
	});

	return true;
}

/**
 * Whether a session has nothing running, in the two words the daemon uses.
 *
 * The footer and the status strip both offer the restart key off this, so it is
 * the one place the question is answered — a hint offered where the key does
 * nothing is worse than no hint.
 *
 * `stopped` is in here and is the one that had to be argued for. It is what a
 * session becomes when someone stops it during the provider's settling window,
 * and it exists precisely so that stopping does not read as `never-started` and
 * invite the pane to start it again. Left out of this list it inverted into the
 * opposite bug: the daemon would have restarted it happily and the screen never
 * offered the key, so a session stopped on purpose could not be started at all.
 */
export function startable(status: AttachStatus | undefined): boolean {
	return (
		status?.state === "never-started" ||
		status?.state === "exited" ||
		status?.state === "stopped"
	);
}

/**
 * Whether there is a process here to put to sleep.
 *
 * The mirror of `startable`, and it is written as its own list rather than as
 * `!startable(...)` because the two are not a partition: `connecting` is
 * neither, and negating would offer hibernate for a session nobody has heard
 * back about yet — a key that acts on a guess.
 *
 * `starting` is in, and it is the one worth arguing. A session inside its
 * provider's settling window has no pid to name and is still a real thing to
 * call off; the daemon has a whole state for that outcome — `stopped`, which
 * exists so that stopping does not read as `never-started` — and leaving
 * `starting` out would make the two seconds codex takes a window in which the
 * key silently does nothing.
 */
export function hibernatable(status: AttachStatus | undefined): boolean {
	return status?.state === "running" || status?.state === "starting";
}

/**
 * This client is the one being typed at.
 *
 * Ownership is attachment-scoped on the daemon's side and never vacated while
 * anyone is attached, so this is a claim and not a lease: it says "the keyboard
 * is here now", which is a thing only the client holding the keyboard knows.
 * There is nothing to give back — a pane losing focus stops sending keys by
 * itself, and handing the token away would leave the daemon dropping everyone's
 * device responses.
 */
export function setWriter(sessionId: string): void {
	attached.get(sessionId)?.attachment.claim();
}

/**
 * The session itself is gone: let go of the screen and the socket.
 *
 * Only called when the row goes. Switching away does not come here — that is
 * the whole point of the registry. And this stops at letting go: the agent was
 * killed by `DELETE /sessions/:id`, before the row was deleted and in the same
 * operation, which is an ordering only one process can have.
 */
export function detachTerminal(sessionId: string): void {
	const entry = attached.get(sessionId);
	if (!entry) return;

	attached.delete(sessionId);
	forgetStatus(sessionId);
	release(entry);
}

/**
 * On the way out.
 *
 * The agents are not ours to hang up on any more. Every one of them is a child
 * of the daemon on a master fd the daemon holds, and this process leaving is a
 * person closing a window, not a machine being switched off — quitting is
 * leaving the room. So this closes sockets and lets go of emulators, and the
 * work carries on without anybody watching it, which is the entire reason the
 * PTYs moved.
 *
 */
export function detachAllTerminals(): void {
	for (const [sessionId, entry] of [...attached]) {
		attached.delete(sessionId);
		release(entry);
	}

	useAttachStatus.setState({ status: {} });
}

/* ------------------------------------------------------------------------ *
 * The daemon path: a socket, an emulator, and an offset into a byte stream.
 * ------------------------------------------------------------------------ */

/** What the pane is allowed to say about a session it is attached to. */
export interface AttachStatus {
	state: SessionFrame["state"] | "connecting";
	pid: number | null;
	exit: { code: number | null; signal: string | null } | null;
	/** the agreed PTY size, which is the smallest attached client's */
	cols: number;
	rows: number;
	clients: number;
	/**
	 * Whether the keyboard reaches the agent from here.
	 *
	 * The write token is the daemon's and only one attachment holds it, and a
	 * connection that does not hold it has its input dropped in silence — the
	 * rule that keeps N emulators from all answering one `ESC[6n`. Silence is
	 * the right thing on the wire and the wrong thing on the screen, so this
	 * comes up to the strip: a window whose keys are going nowhere is a window
	 * that has to be told, or it reads as an agent that has hung.
	 */
	owner: boolean;
	/** the daemon's own sentence, when it refused or gave up */
	error: string | null;
}

const UNKNOWN: AttachStatus = {
	state: "connecting",
	pid: null,
	exit: null,
	cols: 0,
	rows: 0,
	clients: 0,
	owner: false,
	error: null,
};

/**
 * The `session` frame, in a shape the pane can subscribe to.
 *
 * Not a second opinion about what is running: the roster reads `session.pid`
 * off the row, refreshed on the heartbeat, and that stays the answer for every
 * session including the ones nobody is attached to. This is the fast half, and
 * only for the pane on screen — the daemon pushes it because a client attached
 * to a session is the one caller that cannot wait a beat and a half to be told
 * its agent just died.
 */
export const useAttachStatus = create<{
	status: Record<string, AttachStatus>;
}>(() => ({ status: {} }));

const note = (sessionId: string, patch: Partial<AttachStatus>): void => {
	useAttachStatus.setState((state) => ({
		status: {
			...state.status,
			[sessionId]: { ...UNKNOWN, ...state.status[sessionId], ...patch },
		},
	}));
};

const forgetStatus = (sessionId: string): void => {
	useAttachStatus.setState((state) => {
		if (!(sessionId in state.status)) return state;

		const next = { ...state.status };
		delete next[sessionId];
		return { status: next };
	});
};

interface Attached {
	renderable: EmbeddedTerminalRenderable;
	attachment: Attachment;
	/** which process's byte stream the emulator holds; null before the first frame */
	stream: string | null;
	/** how far into that stream it has been fed */
	offset: number;
	replaying: boolean;
	/** this client's viewport, or null while no pane is showing it */
	viewport: { cols: number; rows: number } | null;
	/**
	 * Re-installed on every mount, because a pane's teardown takes `onData` off
	 * on the way out — see the ordering note in `session-terminal.tsx`.
	 */
	input: (data: Uint8Array, source: EmbeddedTerminalDataSource) => void;
	/** the process is leaving: nothing more goes out */
	quitting: boolean;
}

const attached = new Map<string, Attached>();

/**
 * Stands in for the socket for the one statement between building the entry and
 * dialling it, so nothing downstream has to null-check a connection.
 */
const idle: Attachment = {
	send: () => {},
	size: () => {},
	claim: () => {},
	close: () => {},
};

function attachedFor(
	ctx: RenderContext,
	sessionId: string,
): EmbeddedTerminalRenderable {
	const existing = attached.get(sessionId);

	if (existing) {
		// the pane that unmounted last took `onData` with it, and a replay in
		// flight is the one time it must stay off
		if (!existing.replaying) existing.renderable.onData = existing.input;
		return existing.renderable;
	}

	const renderable = build(ctx);

	/*
	 * The agent's own copy, made real. claude's copy-on-select emits OSC 52 at
	 * whatever terminal it believes it is in — which is our emulator, which
	 * parses it and reaches no clipboard. The scanner spots the sequence on the
	 * way past and forwards the text through the same door our own selections
	 * use, so "copied" in the pane means copied on the machine.
	 *
	 * Only while this pane is on screen. A background session is still a
	 * program that can emit anything it likes, and "anything it likes" must not
	 * include overwriting the clipboard from a pane nobody is looking at —
	 * `viewport` is null exactly when no pane is showing it.
	 */
	const osc52 = createOsc52Scanner((text) => {
		if (entry.viewport) copyText(text);
	});

	// replayed bytes count here, unlike for the clipboard: history that set a
	// cursor shape set it for good, and the emulator replaying that history
	// ends in the shaped state this flag has to agree with
	const decscusr = createDecscusrWatch((ps) => {
		renderable.childStyled = ps > 0;
	});

	const entry: Attached = {
		renderable,
		attachment: idle,
		stream: null,
		offset: 0,
		replaying: false,
		viewport: null,
		input: (data) => {
			if (entry.quitting) return;
			entry.attachment.send(data);
		},
		quitting: false,
	};

	renderable.onData = entry.input;

	// A report, not a command. The PTY's size is the daemon's arbitration over
	// every attached client — the smallest wins — so this says how much room
	// this pane has and takes whatever comes back. The old path could resize the
	// child directly because it was the only client there could be.
	renderable.onTerminalResize = (cols, rows) => {
		entry.viewport = { cols, rows };
		entry.attachment.size(cols, rows);
	};

	attached.set(sessionId, entry);

	entry.attachment = attachTerminal(sessionId, {
		cursor: () => ({
			stream: entry.stream,
			since: entry.stream === null ? null : entry.offset,
			cols: entry.viewport?.cols ?? 0,
			rows: entry.viewport?.rows ?? 0,
		}),

		// Nothing here starts anything. The frame is copied to the store and the
		// screen decides what to offer about it — see `startTerminal`.
		onSession: (frame) => {
			note(sessionId, {
				state: frame.state,
				pid: frame.pid,
				exit: frame.exit,
				cols: frame.cols,
				rows: frame.rows,
				clients: frame.clients,
				owner: frame.owner,
				error: null,
			});
		},

		onReplayBegin: (frame) => {
			entry.replaying = true;
			// any half-seen sequence died with the stream the replay replaces —
			// and so did the style the old stream had chosen
			osc52.reset();
			decscusr.reset();
			renderable.childStyled = false;

			/*
			 * History goes in with the input path disconnected, and this is not
			 * caution: `flushResponses()` lives inside `write()`, so replaying a
			 * stream that happens to contain `\x1b[6n` makes this emulator answer
			 * it — a cursor report from a screen that was drawn minutes ago, typed
			 * into a live agent as if someone had pressed it.
			 */
			renderable.onData = undefined;

			// Same process, and the bytes we are owed do not join where we left
			// off: the ring dropped what was in between. A reset is the honest
			// move — writing the survivors on top would splice two halves of a
			// screen together and the seam would be invisible.
			if (frame.stream === entry.stream && frame.from !== entry.offset) {
				renderable.write("\u001bc");
			}

			// A stream the emulator has never seen is a different program's
			// output and is appended, not reset: it is genuinely new, and it
			// belongs under whatever it replaced.
			entry.stream = frame.stream;
			entry.offset = frame.from;
		},

		onOutput: (bytes) => {
			// replayed history is excluded for the reason `\x1b[6n` is above: a
			// copy from minutes ago re-run on attach is not something anybody
			// asked to have on their clipboard now
			if (!entry.replaying) osc52.push(bytes);
			decscusr.push(bytes);
			renderable.write(bytes);
			entry.offset += bytes.byteLength;
		},

		onReplayEnd: (frame) => {
			entry.offset = frame.offset;
			entry.replaying = false;
			if (!entry.quitting) renderable.onData = entry.input;
		},

		onError: (reason) => note(sessionId, { error: reason }),

		onClosed: (code) => {
			// a socket that went while history was still arriving would otherwise
			// leave the input path off for the life of the process
			entry.replaying = false;
			if (!entry.quitting) renderable.onData = entry.input;

			note(sessionId, { state: "connecting", pid: null });

			/*
			 * "It was removed" is the one answer there is no coming back from:
			 * the row is gone, and the session this pane is a view of has stopped
			 * existing.
			 *
			 * "No such session" (4404) used to be taken the same way, and that
			 * was the bad kind of certainty. The daemon says it for a row it
			 * cannot find *and* for a database that would not answer — sqlite
			 * being busy under a second writer, which `db:studio` is — so one
			 * transient read left this pane closed for the life of the process on
			 * a session that was fine, with no way back but restarting the TUI.
			 * It falls through to the backoff now, which climbs to two seconds
			 * and stays there. Being wrong slowly is recoverable; being wrong
			 * forever is not.
			 */
			if (code === CLOSE_REMOVED) entry.attachment.close();
		},
	});

	return renderable;
}

/**
 * Lets go of one attached session, in the order the native side requires.
 *
 * `quitting` before anything else, and `onData` off before the removal: a
 * `remove` calls `onRemove`, which blurs, and a blur encodes a focus-out and
 * sends it through `onData` as input. That byte has nowhere good to go — a
 * detached pane has no focus to report and this socket is closing under it.
 */
const release = (entry: Attached): void => {
	entry.quitting = true;
	entry.renderable.onData = undefined;
	entry.renderable.onTerminalResize = undefined;
	entry.attachment.close();
	entry.renderable.parent?.remove(entry.renderable);
	entry.renderable.destroy();
};
