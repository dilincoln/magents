import type { Session } from "../../daemon/db/schema";
import { type AttachStatus, useAttachStatus } from "../lib/session-terminals";
import { theme } from "../lib/theme";
import { useAppStore, useSelectedRow } from "../store/use-app-store";
import { SessionTerminal } from "./session-terminal";

/**
 * The right-hand side: whatever the roster is pointing at, when that is
 * something worth showing.
 *
 * Only a session is, so far. A session is the one row backed by a process, and
 * a process is the one thing a pane this size is for.
 */
export function DetailPane() {
	const row = useSelectedRow();

	if (row?.kind !== "session") return <Empty />;

	// keyed by the session so that everything below is asked again for a
	// different one. It no longer decides the process's fate: that lives in the
	// terminal registry, and a session switched away from keeps running.
	return <SessionPane key={row.session.id} session={row.session} />;
}

/**
 * One `if`, two whole panes, and nothing between them.
 *
 * They are different screens because they are looking at different things. One
 * is attached to a process the daemon owns and asks it what it is; the other
 * works out a command and starts a child of this process. Interleaving them
 * would mean every line below reading as a question about which world it is in.
 */
function SessionPane({ session }: { session: Session }) {
	return <AttachedPane session={session} />;
}

/**
 * A view of an agent the daemon is running.
 *
 * There is nothing to work out here: no argv, no project path, no settling
 * time. All of it moved to the other side of the socket, where the
 * thing that runs the provider is, and what comes back is a session frame
 * describing what actually happened. That includes the refusals — a session
 * with no handle to reattach to is a sentence the daemon writes, and this pane
 * prints it rather than deducing it from a missing command.
 */
function AttachedPane({ session }: { session: Session }) {
	const focus = useAppStore((state) => state.focus);
	const focusTerminal = useAppStore((state) => state.focusTerminal);
	const status = useAttachStatus((state) => state.status[session.id]);

	return (
		<box
			style={{
				flexGrow: 1,
				height: "100%",
				flexDirection: "column",
				backgroundColor: theme.bg,
			}}
		>
			{/* the terminal takes what the strip leaves, and the percentage inside
			    it resolves against this box rather than against the whole pane */}
			<box style={{ width: "100%", flexGrow: 1, flexShrink: 1 }}>
				<SessionTerminal
					sessionId={session.id}
					focused={focus === "terminal"}
					onFocus={focusTerminal}
				/>

				{focus === "terminal" ? null : <Veil onAttach={focusTerminal} />}
			</box>

			<StatusStrip status={status} />
		</box>
	);
}

/**
 * What is over an unattached session: the screen, dimmed, and the way in.
 *
 * A pane and an attached pane look identical — the agent's screen is there
 * either way, live, redrawing — and the only difference is where the keys go.
 * That is invisible until you type into the roster and something else happens,
 * which is a bad way to find out. So the state is drawn rather than deduced.
 *
 * A veil and not a panel: what is underneath is the thing you came to look at,
 * and covering it to say "you are not attached" would answer a small question
 * by taking away the answer to the big one. The colour blends, so the agent
 * stays readable through it.
 *
 * It takes the click that the terminal underneath would otherwise have had, so
 * it has to give it back — a pane that stopped responding to the mouse the
 * moment it grew a hint would be a worse trade than the hint is worth.
 */
function Veil({ onAttach }: { onAttach: () => void }) {
	return (
		<box
			onMouseDown={onAttach}
			style={{
				position: "absolute",
				left: 0,
				top: 0,
				width: "100%",
				height: "100%",
				zIndex: 1,
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: theme.veil,
			}}
		>
			<text selectable={false} style={{ fg: theme.text }}>
				⏎ or → to attach
			</text>
		</box>
	);
}

/**
 * One line saying what is on the other end of the socket, when there is
 * something to say.
 *
 * It used to be unconditional, and the reason was real: a strip that comes and
 * goes changes the pane's height, the pane's height is this client's vote on
 * the PTY size, and a vote that changes makes the daemon resize the agent. A
 * redraw caused by nothing the agent did.
 *
 * `running · 120×32` was what that cost bought, on every healthy session, for
 * the life of the pane — a size nobody needs to read and a word for a state
 * that is visible from the fact that there is a screen. The row is worth more
 * to the agent. So the line is spent only on things that are worth reading, and
 * the resize it causes happens when a session starts or ends rather than while
 * one is working.
 *
 * What is worth reading: a refusal in the daemon's own words, an agent that has
 * ended and the key that brings it back, a session with nothing on it, and —
 * the reason this exists at all — the write token. With the process outliving
 * every window, a window can be attached, focused, and typing into nothing,
 * because the daemon gives exactly one attachment the token and drops the rest
 * in silence. Silence is right on the wire and wrong on the screen.
 */
function StatusStrip({ status }: { status: AttachStatus | undefined }) {
	const state = status ?? null;

	// A healthy agent, alone, with the keyboard: the screen below says all of it
	// already. This is the case the row is being given back for.
	if (
		state &&
		!state.error &&
		state.state === "running" &&
		state.owner &&
		state.clients <= 1
	) {
		return null;
	}

	const words = !state
		? "connecting…"
		: state.error
			? state.error
			: state.state === "exited"
				? `exited${ended(state)} · ⌃r starts it again`
				: // Its own sentence, and not a shade of the two around it. The screen
					// behind this one is deliberately blank, so the line is all there is
					// to say which kind of blank it is — a session asleep because
					// somebody put it to sleep, rather than one still connecting or one
					// that fell over having printed nothing.
					state.state === "stopped"
					? "hibernated · ⌃r wakes it"
					: // Also its own sentence, and for a reason that arrived late. This
						// was a two-second settling window folded into the generic branch
						// below, where it printed the bare word and a size — fine for two
						// seconds. Codex will not save a resumable session until the first
						// turn has finished, so `openSession` answers straight away and
						// leaves this on screen for as long as the work takes. Over two
						// minutes of a black pane and the word `starting`, with `⌃r`
						// answering "already running", is a session that looks stuck. The
						// line says which of the two it is.
						state.state === "starting"
						? "opening · running the first turn — nothing to show until it lands"
						: state.state === "never-started"
							? "nothing running · ⌃r starts it"
							: `${state.state} · ${state.cols}×${state.rows}${
									state.clients > 1 ? ` · ${state.clients} attached` : ""
								}${state.owner ? "" : " · read-only, another client holds the keyboard"}`;

	return (
		<text
			selectable={false}
			style={{
				width: "100%",
				flexShrink: 0,
				bg: theme.panel,
				fg: state?.error ? theme.warn : theme.faint,
			}}
		>
			{` ${words}`}
		</text>
	);
}

const ended = (status: AttachStatus): string => {
	if (!status.exit) return "";
	if (status.exit.signal) return ` · killed by ${status.exit.signal}`;
	// `?? 0` was here and was the wrong kind of tidy: a null code means nobody
	// asked the process how it went, not that it went well.
	return status.exit.code === null ? "" : ` · code ${status.exit.code}`;
};

/** Nothing to show, and a word about why when there is one. */
function Empty({ note }: { note?: string }) {
	return (
		<box
			style={{
				flexGrow: 1,
				height: "100%",
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: theme.bg,
			}}
		>
			{note ? (
				<text selectable={false} style={{ fg: theme.faint }}>
					{note}
				</text>
			) : null}
		</box>
	);
}
