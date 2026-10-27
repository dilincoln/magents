import type { ServerWebSocket } from "bun";
import { eq, inArray } from "drizzle-orm";
import { Console, Effect, Runtime } from "effect";
import type { Session } from "../db/schema";
import { sessions } from "../db/schema";
import { DatabaseError } from "../errors/database-error";
import {
	type TerminalState as AttachTerminalState,
	CLOSE_NO_SESSION,
	CLOSE_REMOVED,
	CLOSE_TOO_SLOW,
	CLOSE_UNAVAILABLE,
} from "../lib/attach-frames";
import { startedAt } from "../lib/pid-identity";
import { Database } from "./database";

/**
 * Every agent's process, held by the daemon rather than by whoever is looking.
 *
 * This is the half of the TUI's session registry that had to move. A PTY child
 * dies when the last master fd closes — measured, and indistinguishable from
 * the parent's point of view whether it exited, was SIGTERMed or was SIGKILLed
 * — and that fd used to live in the TUI, so closing the TUI hung up every agent
 * in it. Here the daemon holds it: a client can quit, be killed, or stay away
 * for an hour, and the agent keeps working because nothing it depends on went
 * anywhere. The daemon's own shutdown is then the only thing that ends an
 * agent, which is why the release below is written as carefully as it is.
 *
 * Because nobody has to be watching, the bytes have to be kept: a session holds
 * a ring of its own recent output, and attaching replays it before the live
 * stream starts. That ring is the whole reason a client can be SIGKILLed
 * mid-task and come back to the screen it left.
 *
 * The acquired value is a plain object of plain-JS methods, the same shape
 * `Database` hands out, and that is deliberate. These methods are called from
 * Bun's own callbacks — a PTY's `data`, a socket's `message` — which run
 * outside any fiber, and paying a fiber per keystroke to reach a Map would be
 * an absurd price for nothing. The database writes they do go the other way,
 * through the captured `Runtime.runPromise` with a named `DatabaseError` and a
 * `catchAll` that logs, because an unhandled rejection raised inside a Bun
 * callback has nobody listening for it and would leave a row claiming an agent
 * is running long after it stopped.
 *
 * The registry is the authority on what is running. The `pid` column is a
 * projection of it, written here and read at boot by the code that has to clean
 * up after a daemon that never got to run this.
 */

/**
 * How long a child gets to answer SIGTERM before it is killed outright.
 *
 * Long enough for a CLI to write its transcript out and short enough that
 * ctrl-c on the daemon still feels like ctrl-c.
 */
const GRACE_MS = 2_000;

/**
 * How much of a session's output is kept for whoever attaches next.
 *
 * Four megabytes is a few thousand lines of a CLI that redraws, which is the
 * shape of the thing being kept — and it is per session, held for the daemon's
 * whole life, so ten sessions is forty megabytes of resident memory bought
 * outright. The env override exists because that trade is a machine's to make,
 * not this file's.
 */
const RING_BYTES = Number(process.env.MAGENTS_HISTORY_BYTES) || 4 * 1024 * 1024;

/** The largest frame the daemon will send. Only replay ever approaches it. */
const CHUNK = 64 * 1024;

/**
 * When a client is so far behind that it is costing the daemon memory.
 *
 * Measured against the daemon's own queue and not against the socket, which is
 * the correction this stage owed: `pump` stops handing Bun frames once
 * `getBufferedAmount` passes HIGH_WATER and a frame is at most 64 KiB, so the
 * buffered amount can never come within ten megabytes of a cutoff this size and
 * the branch that tested it was unreachable. A SIGSTOPped client was measured
 * taking the daemon from 102,296 kB to 184,612 kB of RSS — the whole burst —
 * while its socket sat at two megabytes buffered and nothing fired. What grows
 * is the queue of chunks a stopped reader has not taken, and that is what this
 * counts.
 *
 * Six rings, because the largest legitimate backlog is one whole replay: a
 * healthy client reattaching queues the ring in one go, so a cutoff that does
 * not clear it by a wide margin is a bug that only fires on success. The
 * default is the same twenty-four megabytes as before, and a machine that
 * raises MAGENTS_HISTORY_BYTES raises this with it.
 */
const SLOW_CLIENT_BYTES = RING_BYTES * 6;

/** Where a sender stops and waits for `drain` rather than buffering more. */
const HIGH_WATER = 2 * 1024 * 1024;

/**
 * What a fresh process is sized for before anyone has voted.
 *
 * 80×24 was the TUI's answer and it was answerable there, because a pane
 * existed the moment a process did. Here there may be no layout for minutes, or
 * ever, and an agent that formats its whole first turn for eighty columns has
 * already made a mess that resizing does not undo.
 */
const DEFAULT_SIZE = { cols: 120, rows: 32 };

/** Below this a CLI's own layout code starts dividing by zero. */
const MIN_COLS = 20;
const MIN_ROWS = 5;

/**
 * The largest viewport anyone is believed about.
 *
 * A PTY's winsize is two unsigned shorts and Bun refuses anything wider —
 * `resize(65536, 5)` throws `resize() requires valid cols argument`, measured,
 * and out of a WebSocket message callback there is nobody to catch it.
 */
const MAX_DIMENSION = 65_535;

/**
 * The close codes and the state vocabulary come from `attach-frames`, which is
 * the file both sides of this socket import.
 *
 * Declaring them here as well was the arrangement that made a shared module
 * pointless: the TUI read the shared copy, this file read its own, and the two
 * drifted within the hour — `stopped` was emitted from here and absent there,
 * which locked a stopped session out of ever being restarted from the screen.
 * A contract with two declarations has no compiler behind it, which is the one
 * property it was created to have.
 */
export type TerminalState = AttachTerminalState;

/**
 * A stored row with what the registry knows written over the top of it.
 *
 * `state` rides along beside the overlaid pid because the pid alone cannot say
 * "coming up": a session inside its provider's settling window has no process
 * yet, and a roster reading only the pid paints it dead for as long as that
 * window is — two seconds, while codex needed one — a row that lies, which is
 * the one thing the lifecycle this file implements is not allowed to do.
 */
export interface LiveSession extends Session {
	state: TerminalState;
}

/** What the daemon knows about one session's process. */
interface Live {
	/** null while the provider's settling time is being waited out, and again once the process ends */
	child: ReturnType<typeof Bun.spawn> | null;
	timer: ReturnType<typeof setTimeout> | null;
	/**
	 * `stopped` is not a shade of `never-started`, and the difference is load
	 * bearing: a client reads `never-started` as an invitation to POST a
	 * terminal, so answering it to someone who has just asked for the agent to
	 * stop makes stopping the agent start it.
	 */
	state: TerminalState;
	exit: { code: number | null; signal: string | null } | null;
	/**
	 * Whether the process is ending because somebody asked it to.
	 *
	 * The two ways a child dies are indistinguishable from the exit hook — a
	 * SIGTERM we sent and a SIGTERM from anywhere else arrive identically — and
	 * they deserve opposite treatment. An agent that fell over leaves its last
	 * words on the screen because they are the evidence; one that was put to
	 * sleep leaves nothing, because there is nothing to explain and a person who
	 * asked for it to stop is not asking to be shown a corpse.
	 *
	 * Set by `kill` before it signals and cleared by the next `launch`, so it
	 * describes one ending and not the session.
	 */
	hibernating: boolean;
	/**
	 * This process's byte stream. Minted with the entry and again whenever a
	 * process starts on a stream that already has bytes on it — which is what
	 * makes it change exactly when the output genuinely restarts, and not on the
	 * first start of a session a client is already watching.
	 */
	streamId: string;
	/** bytes emitted on this stream, ever — the ring is a window into it */
	offset: number;
	ring: Uint8Array[];
	ringBytes: number;
	/** the stream offset the first byte still in the ring sits at */
	ringFrom: number;
	truncated: boolean;
	clients: Set<ServerWebSocket<AttachData>>;
	owner: ServerWebSocket<AttachData> | null;
	size: { cols: number; rows: number };
}

/** What the attach route parses off the query string and hands to the socket. */
export interface AttachData {
	sessionId: string;
	/**
	 * This client's viewport, mutated in place when it sends `{"t":"size"}`.
	 * It lives on the socket because that is what it is a fact about, and
	 * because the size vote has to survive being counted from a `close` handler
	 * where the entry is all that is left.
	 */
	cols: number;
	rows: number;
	/** the stream this client already holds bytes from, if it is reconnecting */
	stream: string | null;
	since: number | null;
}

/** A frame waiting for backpressure to clear: output, or a bracket around it. */
type Pending = Uint8Array | string;

/**
 * One client's queue, with what it is costing measured beside it.
 *
 * The running total is the point of the wrapper. It is what the slow-client
 * cutoff reads — the socket's own buffered amount is bounded by HIGH_WATER and
 * therefore says nothing about how far behind a reader is — and keeping it here
 * rather than summing the array is what makes checking it on every chunk free.
 */
interface Feed {
	items: Pending[];
	bytes: number;
}

const encoder = new TextEncoder();

const acquire = Effect.gen(function* () {
	const { db } = yield* Database;
	const run = Runtime.runPromise(yield* Effect.runtime<Database>());

	const registry = new Map<string, Live>();

	/**
	 * What each client still owes its socket, in order.
	 *
	 * Everything the daemon sends a client goes through here rather than
	 * straight to `send`, which costs an array push per chunk and buys the one
	 * property replay depends on: a live byte that arrives while history is
	 * still going out queues behind it instead of overtaking it. Order across
	 * binary and text frames is the WebSocket's own guarantee, so bracketing
	 * replay needs no sequence numbers — but only if the sender never reorders
	 * them itself.
	 */
	const feeds = new Map<ServerWebSocket<AttachData>, Feed>();

	/** The projection catching up: these sessions have no process any more. */
	const clearPids = (ids: string[]): Promise<void> =>
		run(
			Effect.try({
				try: () =>
					db
						.update(sessions)
						.set({ pid: null, pidStartedAt: null })
						.where(inArray(sessions.id, ids))
						.run(),
				catch: (cause) =>
					new DatabaseError({ operation: "terminals/pid", cause }),
			}).pipe(
				Effect.catchAll((error) =>
					Console.error(`${error.operation} failed: ${error.cause}`),
				),
				Effect.asVoid,
			),
		);

	/** The same projection, going the other way, with the tiebreak beside it. */
	const notePid = (sessionId: string, pid: number): Promise<void> =>
		run(
			Effect.try({
				try: () =>
					db
						.update(sessions)
						.set({ pid, pidStartedAt: startedAt(pid) })
						.where(eq(sessions.id, sessionId))
						.run(),
				catch: (cause) =>
					new DatabaseError({ operation: "terminals/pid", cause }),
			}).pipe(
				Effect.catchAll((error) =>
					Console.error(`${error.operation} failed: ${error.cause}`),
				),
				Effect.asVoid,
			),
		);

	/**
	 * The group, not the child.
	 *
	 * Bun makes a PTY child a session leader, so its pid is also its process
	 * group id (measured: PGID == SID == PID), and a provider CLI that spawned
	 * helpers of its own has them in that group. Signalling the child alone
	 * leaves them running with nobody left who knows they exist.
	 */
	const signalGroup = (
		child: ReturnType<typeof Bun.spawn>,
		signal: "SIGTERM" | "SIGKILL",
	): void => {
		try {
			process.kill(-child.pid, signal);
		} catch {
			// gone between the decision and the signal, which is the outcome we
			// were asking for anyway
		}
	};

	const blank = (): Live => ({
		child: null,
		timer: null,
		state: "never-started",
		exit: null,
		hibernating: false,
		streamId: Bun.randomUUIDv7(),
		offset: 0,
		ring: [],
		ringBytes: 0,
		ringFrom: 0,
		truncated: false,
		clients: new Set(),
		owner: null,
		size: { ...DEFAULT_SIZE },
	});

	/**
	 * Takes the right to start this session's process, or refuses it.
	 *
	 * `has` and `set` inside one synchronous function, which is what makes it
	 * atomic: JS runs it to completion, so a `POST /sessions` and a client
	 * attaching to the same row a millisecond later cannot both come away
	 * believing they are the one starting it, whatever the fibers around them
	 * are doing. The loser is told the session is already running rather than
	 * opening a second agent on the same conversation.
	 *
	 * An entry that exists is not by itself a refusal. Attaching makes one, and
	 * a process that ended leaves one behind on purpose — its last screen is in
	 * there. Both are startable; only a process that exists, or a settling
	 * timer that is going to make one, is not.
	 */
	const claimStart = (sessionId: string): boolean => {
		const entry = registry.get(sessionId);

		if (!entry) {
			registry.set(sessionId, { ...blank(), state: "starting" });
			return true;
		}

		if (entry.state === "starting" || entry.state === "running") return false;

		// The ring, the stream and how the last process ended are all left alone
		// here and rebuilt in `launch`, where a process actually exists. Clearing
		// them on the claim erased the dead agent's last screen for a start that
		// then failed its own checks and answered 422 — the claim can be put back,
		// the bytes cannot.
		entry.state = "starting";

		// `starting` has to reach the wire or it is not a state at all: a client
		// told nothing between the claim and the process keeps reading the frame
		// before it for as long as the provider takes to settle, which was two
		// seconds of a pane believing nothing had ever run here while codex had
		// a settling window.
		announce(entry);
		return true;
	};

	/**
	 * Puts back a claim that turned out to have nothing to run.
	 *
	 * Without this a session whose handle could not be found stays `starting`
	 * for the life of the daemon and every later attempt is refused with
	 * "already running", which is both false and unfixable without a restart.
	 *
	 * What it puts back is read off the stream rather than remembered: bytes on
	 * it mean a process ran here and what it last printed is still in the ring,
	 * so the entry is `exited` and worth keeping even with nobody watching.
	 * Answering `never-started` and dropping the entry threw that screen away on
	 * every refused restart — the 422 path exists precisely for a session whose
	 * agent is gone, which is the one case where the last screen is all there is.
	 */
	const abandon = (sessionId: string): void => {
		const entry = registry.get(sessionId);
		if (entry?.state !== "starting" || entry.child || entry.timer) {
			return;
		}

		entry.state = entry.offset > 0 ? "exited" : "never-started";

		if (entry.state === "never-started" && entry.clients.size === 0) {
			registry.delete(sessionId);
			return;
		}

		announce(entry);
	};

	const sessionFrame = (entry: Live, ws: ServerWebSocket<AttachData>): string =>
		JSON.stringify({
			t: "session",
			state: entry.state,
			pid: entry.child?.pid ?? null,
			exit: entry.exit,
			stream: entry.streamId,
			cols: entry.size.cols,
			rows: entry.size.rows,
			clients: entry.clients.size,
			owner: entry.owner === ws,
		});

	/**
	 * Status to everyone attached, out of band and ahead of anything queued.
	 *
	 * Deliberately not through the feed. A session frame is not part of the byte
	 * stream — the client brackets history on `replay-begin`/`replay-end` and
	 * treats every binary frame between them as history regardless of what text
	 * went past — so putting status behind a megabyte of replay would delay the
	 * one thing the pane needs immediately in order to say what it is doing.
	 */
	const announce = (entry: Live): void => {
		for (const ws of entry.clients) {
			if (ws.readyState === 1) ws.send(sessionFrame(entry, ws));
		}
	};

	const cut = (ws: ServerWebSocket<AttachData>): void => {
		if (ws.readyState === 1) {
			ws.send(
				JSON.stringify({
					t: "error",
					reason: "this connection is too far behind to keep feeding",
				}),
			);
			ws.close(CLOSE_TOO_SLOW, "too slow");
		}
		detach(ws);
	};

	const weight = (item: Pending): number =>
		typeof item === "string" ? item.length : item.byteLength;

	/**
	 * Sends what it can, stops where the socket says to, and hangs up on a reader
	 * that has stopped reading.
	 *
	 * `getBufferedAmount` is the whole flow-control story: Bun's `send` never
	 * drops and never reorders — it returned -1 for backpressure 47,505 times
	 * out of 50,000 in a 64 MiB burst and delivered every byte — so the only
	 * thing worth doing is refusing to hand it more until it has drained, which
	 * is what the `drain` callback resumes.
	 *
	 * The two gauges are different questions and the order they are asked in
	 * matters. Buffered bytes say whether Bun wants more right now and are
	 * bounded by HIGH_WATER by construction; the queue says how far behind this
	 * client is and is bounded by nothing, which is why the cutoff reads it and
	 * reads it before the high-water return that would otherwise skip the check
	 * for exactly the client that needs it.
	 */
	const pump = (ws: ServerWebSocket<AttachData>): void => {
		const feed = feeds.get(ws);
		if (!feed) return;

		while (feed.items.length > 0) {
			if (ws.readyState !== 1) {
				feeds.delete(ws);
				return;
			}

			if (feed.bytes > SLOW_CLIENT_BYTES) {
				cut(ws);
				return;
			}

			if (ws.getBufferedAmount() > HIGH_WATER) return;

			const next = feed.items.shift();
			if (next === undefined) return;

			feed.bytes -= weight(next);
			ws.send(next);
		}
	};

	const push = (ws: ServerWebSocket<AttachData>, item: Pending): void => {
		const feed = feeds.get(ws);
		if (!feed) return;

		feed.items.push(item);
		feed.bytes += weight(item);
		pump(ws);
	};

	/**
	 * Keeps the bytes, and drops the oldest when there are too many.
	 *
	 * Whole chunks come off the head, which is the simplification this stage is
	 * allowed to make and it has a cost worth naming: the cut lands wherever the
	 * PTY happened to flush, so a truncated replay can begin in the middle of an
	 * escape sequence — `?25l` arriving as literal text — or after the SGR that
	 * set the colours it is drawn in, and the screen is then wrong in a way
	 * nothing says out loud. `truncated: true` on `replay-begin` is what the
	 * pane has instead, so it can say "earlier output not shown" rather than
	 * pretend. The real fix is a prefix scanner that advances the cut to a
	 * parser-ground offset and synthesizes a preamble restoring the DEC modes
	 * and SGR runs in effect there; it is a file of its own and it is fidelity
	 * work, not lifecycle work.
	 *
	 * The chunk is copied. Bun hands the `data` callback a view it is free to
	 * reuse for the next read, and a ring holding views instead of bytes would
	 * be a history that rewrites itself behind the reader.
	 */
	const remember = (entry: Live, chunk: Uint8Array): Uint8Array => {
		const kept = new Uint8Array(chunk);

		entry.ring.push(kept);
		entry.ringBytes += kept.byteLength;
		entry.offset += kept.byteLength;

		while (entry.ringBytes > RING_BYTES && entry.ring.length > 1) {
			const gone = entry.ring.shift();
			if (!gone) break;

			entry.ringBytes -= gone.byteLength;
			entry.ringFrom += gone.byteLength;
			entry.truncated = true;
		}

		return kept;
	};

	const emit = (entry: Live, chunk: Uint8Array): void => {
		const kept = remember(entry, chunk);

		for (const ws of entry.clients) {
			for (let at = 0; at < kept.byteLength; at += CHUNK) {
				push(ws, kept.subarray(at, at + CHUNK));
			}
		}
	};

	/**
	 * A new process is a new byte stream, and everyone attached is told so.
	 *
	 * The ring holds the previous process's screen and a client that kept
	 * counting past it would be splicing two programs' output into one
	 * scrollback — so the id changes and the ring goes. The bracket is what makes
	 * that survivable, and it is the whole of the fix: a client only ever learns
	 * a stream id from `replay-begin`, so a restart that minted one silently left
	 * every attached client dialling back with an id the daemon had forgotten and
	 * an offset into a stream that no longer existed. The daemon answered that
	 * with the entire ring, and the client — seeing a stream it did not recognise
	 * — appended it under what was already drawn. One reconnect, the session's
	 * scrollback twice.
	 *
	 * Nothing is sent for a stream with no bytes on it. A session that has never
	 * run is not a different program from the one about to run, and re-bracketing
	 * a client that was told the empty stream a moment ago is noise it would have
	 * to have a second path through its state machine to absorb.
	 */
	const restart = (entry: Live): void => {
		if (entry.offset === 0) return;
		mintStream(entry);
	};

	/**
	 * Throws the stream away and hands everyone a fresh, empty one.
	 *
	 * The bracket is not decoration. A client only ever learns a stream id from
	 * `replay-begin`, so a stream minted in silence leaves every attached client
	 * dialling back with an id the daemon has forgotten and an offset into a
	 * stream that no longer exists — see `restart`, whose comment is where this
	 * was worked out and paid for.
	 */
	const mintStream = (entry: Live): void => {
		entry.streamId = Bun.randomUUIDv7();
		entry.offset = 0;
		entry.ring = [];
		entry.ringBytes = 0;
		entry.ringFrom = 0;
		entry.truncated = false;

		for (const ws of entry.clients) {
			push(
				ws,
				JSON.stringify({
					t: "replay-begin",
					stream: entry.streamId,
					from: 0,
					bytes: 0,
					truncated: false,
				}),
			);
			push(ws, JSON.stringify({ t: "replay-end", offset: 0 }));
		}
	};

	/**
	 * Wipes a session's screen — the ring, and every emulator showing it.
	 *
	 * Two audiences and one mechanism. Whoever attaches later replays the ring,
	 * so emptying it is the whole of their answer; whoever is attached *now* has
	 * the screen in an emulator on their side of the socket, and a new stream
	 * does not clear it — the client appends a stream it has not seen, which is
	 * right for a restart, where the new program's output belongs under what it
	 * replaced.
	 *
	 * So the clear travels as output, which is the layer it belongs to: a screen
	 * going blank is a thing terminals already say to each other, and saying it
	 * in the byte stream means no new frame type, no new branch in the client,
	 * and one answer that is true for both audiences.
	 *
	 * `RIS` and not `ESC [2J`: both blank the visible screen (measured against
	 * the renderable, with a control that showed the history still there), but a
	 * process that is gone should leave none of its modes behind either — alt
	 * screen, mouse reporting, wrap, colours. `ESC [3J` follows it for the saved
	 * lines, which is the one part of this the test API cannot see and which is
	 * therefore by the specification rather than by measurement.
	 */
	const BLANK = `${String.fromCharCode(27)}c${String.fromCharCode(27)}[3J`;

	const wipe = (entry: Live): void => {
		mintStream(entry);
		emit(entry, encoder.encode(BLANK));
	};

	/**
	 * The agreed size: the smallest viewport anyone is showing.
	 *
	 * tmux's rule, and it deletes a class of code rather than adding one —
	 * because no client is ever *smaller* than the PTY, each pane's emulator can
	 * stay at its own size and nothing has to letterbox.
	 *
	 * The floor is the exception and it is deliberate rather than overlooked. A
	 * client voting below 20×5 is handed a PTY strictly larger than its viewport
	 * and its emulator clips, which is the letterboxing case the paragraph above
	 * says does not arise; it arises there, and it is still the better outcome,
	 * because below that a CLI's own layout arithmetic starts dividing by zero
	 * and what it draws is not clipped, it is garbage.
	 *
	 * It matters that this is retained when the last client leaves rather than
	 * reset: an agent whose output reflows the moment the last person looks away
	 * has been given a reason to redraw that has nothing to do with its work.
	 */
	const agreed = (entry: Live): { cols: number; rows: number } => {
		let cols = 0;
		let rows = 0;

		for (const ws of entry.clients) {
			if (ws.data.cols <= 0 || ws.data.rows <= 0) continue;
			cols = cols === 0 ? ws.data.cols : Math.min(cols, ws.data.cols);
			rows = rows === 0 ? ws.data.rows : Math.min(rows, ws.data.rows);
		}

		if (cols === 0 || rows === 0) return entry.size;

		return { cols: Math.max(cols, MIN_COLS), rows: Math.max(rows, MIN_ROWS) };
	};

	const resize = (entry: Live): boolean => {
		const next = agreed(entry);
		if (next.cols === entry.size.cols && next.rows === entry.size.rows) {
			return false;
		}

		// the PTY first and the record of it second: `resize` throws out of
		// whatever Bun callback we are standing in, and writing the size down
		// before asking for it left every later `session` frame advertising a size
		// no process was ever given
		entry.child?.terminal?.resize(next.cols, next.rows);
		entry.size = next;
		return true;
	};

	/**
	 * How a process ended, in the words the pane uses.
	 *
	 * Read off the subprocess and not off the PTY hook's own second argument,
	 * which is measurably always `1` — `exit 3` and `exit 0` both reported it.
	 * The pane spent that whole time announcing "exited with 1" for everything.
	 */
	const ending = (child: ReturnType<typeof Bun.spawn>): string =>
		child.signalCode
			? `killed by ${child.signalCode}`
			: `exited with ${child.exitCode ?? 0}`;

	/**
	 * What the child is told it is talking to.
	 *
	 * Set here and not inherited, because the daemon's own environment is the
	 * wrong authority on this. The agent is not talking to whatever terminal the
	 * daemon was started from — it is talking to the emulator in the pane, and
	 * what that emulator can do is a fixed fact about this program rather than
	 * something to be guessed from context.
	 *
	 * It was inherited until the daemon became a systemd service, and that is
	 * exactly when it broke: a user service starts with HOME, PATH, LANG and
	 * little else, so the agent came up with no TERM at all and turned every
	 * colour off. Measured, on the same claude, capturing what it writes to the
	 * pty in its first five seconds:
	 *
	 *   started from a terminal    5 colour sequences, 256-colour
	 *   started by systemd         0
	 *   with these two             5 colour sequences, 24-bit
	 *
	 * So this is not only the fix, it is better than what was there before —
	 * `COLORTERM` was never set on the way in either, and the pane has always
	 * rendered 24-bit (verified against the renderable: `38;5;196`, `38;2;…` and
	 * `31` all come out as the colours they name).
	 *
	 * `xterm-256color` because the terminfo entry is on every machine and
	 * describes what the emulator actually implements. Claiming something more
	 * specific would be claiming capabilities we would then have to have.
	 */
	const SCREEN = {
		TERM: "xterm-256color",
		COLORTERM: "truecolor",
	} as const;

	/**
	 * What the child is *not* told, for the same reason.
	 *
	 * The two above say what the pane can do; these two say what somebody
	 * wants, and the somebody is whoever started the daemon — a `NO_COLOR` in
	 * their shell, or a `FORCE_COLOR=0` a CI script left behind, would ride
	 * in through `process.env` and turn the agent monochrome after the two
	 * above had said otherwise. Every colour library reads them first. A
	 * daemon started by systemd never has them, which is why a daemon started
	 * from a shell is the one that would have surprised somebody.
	 */
	const UNSAID = ["NO_COLOR", "FORCE_COLOR"] as const;

	/** The daemon's environment, minus what the child must decide for itself. */
	const inherited = (): Record<string, string | undefined> => {
		const env = { ...process.env };
		for (const name of UNSAID) delete env[name];
		return env;
	};

	/**
	 * Starts the process and wires the PTY to the ring, both ways.
	 *
	 * Returns what went wrong if the spawn itself refused, so that a start with
	 * no settling time can answer the request that asked for it with a status
	 * code. A provider binary missing from PATH used to answer 200 with a session
	 * that looked fine, and `spawn failed` was a variant nothing constructed.
	 */
	const launch = (
		sessionId: string,
		entry: Live,
		argv: string[],
		cwd: string,
		env: Readonly<Record<string, string>> | undefined,
	): Error | null => {
		entry.timer = null;
		// the flag describes one ending, not the session: a start that lands after
		// a hibernation would otherwise have its own exit read as one
		entry.hibernating = false;

		let child: ReturnType<typeof Bun.spawn>;

		try {
			child = Bun.spawn(argv, {
				cwd,
				// Spelled out rather than passed through, because `env` on its own
				// *replaces* the environment: a provider asking for one variable
				// would otherwise be run with only that one, without a PATH to find
				// itself on. The order is the precedence — inherited, then what
				// this terminal is, then what the adapter asked for, so an adapter
				// can still say something different about a variable we set.
				// `MAGENTS_SESSION` is how a hook knows which row it is about. It
				// rides in the environment rather than in the hook's command string
				// because a hook is a subprocess of the agent and inherits it —
				// measured — which keeps the command a constant instead of an id
				// interpolated through JSON and then through an argv.
				env: {
					...inherited(),
					...SCREEN,
					MAGENTS_SESSION: sessionId,
					...env,
				},
				terminal: {
					cols: entry.size.cols,
					rows: entry.size.rows,
					data(_pty, chunk) {
						emit(entry, chunk);
					},
					exit() {
						// a restart or a removal that already happened owns this entry
						// no longer, and writing to it here would put a dead process's
						// last words into a live session's history
						if (registry.get(sessionId) !== entry || entry.child !== child) {
							return;
						}

						entry.child = null;

						if (entry.hibernating) {
							/*
							 * Asked for, so there is nothing to report and nothing to
							 * keep. `stopped` rather than `exited` is the point of that
							 * state existing — "somebody stopped this" is a different
							 * fact from "this ended", and it is the one a screen has to
							 * read to know whether the blank rectangle in front of it is
							 * a session asleep or a session that fell over.
							 *
							 * No exit status either. `killed by SIGTERM` is true and is
							 * exactly the noise being removed: it is our own signal,
							 * reported back to the person who asked us to send it.
							 */
							entry.hibernating = false;
							entry.state = "stopped";
							entry.exit = null;
							wipe(entry);
						} else {
							entry.state = "exited";
							entry.exit = { code: child.exitCode, signal: child.signalCode };
							// said in the history rather than swallowed: a CLI that
							// refused to start leaves an empty black rectangle otherwise,
							// and an empty rectangle is indistinguishable from one still
							// loading — and it is the last thing a background session
							// leaves behind, so a client attaching an hour later has to
							// find it there
							emit(entry, encoder.encode(`\r\n[${ending(child)}]\r\n`));
						}

						announce(entry);
						void clearPids([sessionId]);
					},
				},
			});
		} catch (cause) {
			const failure = cause instanceof Error ? cause : new Error(String(cause));

			// said in the history as well as returned, because the caller is not
			// always still there: nobody is on the other end of a settling timer,
			// and the request that asked for this answered when it was armed. The
			// ring is where the session's other facts are and it is the only
			// place a failure that late can be read.
			entry.state = "exited";
			// and no exit status, because nothing ran to have one. A zeroed
			// `{ code: null, signal: null }` looked tidier and rendered on the
			// status strip as `exited · code 0` — a clean finish, for a CLI that
			// was never found on $PATH. The sentence about what happened is the
			// line going into the ring below.
			entry.exit = null;
			emit(
				entry,
				encoder.encode(
					`\r\n[could not start ${argv[0]}: ${failure.message}]\r\n`,
				),
			);
			announce(entry);
			return failure;
		}

		// after the spawn and not before it: a start that never happened is not a
		// new stream, and clearing the ring for one would throw away the screen
		// the failure is about to be written under
		restart(entry);

		// only now: a claim that never became a process leaves the previous
		// ending readable, which is what `abandon` puts the entry back to
		entry.exit = null;
		entry.child = child;
		entry.state = "running";
		announce(entry);
		void notePid(sessionId, child.pid);
		return null;
	};

	/**
	 * Starts a claimed session, after the provider's own settling time.
	 *
	 * The wait is asked of the adapter rather than guessed here, and nothing
	 * cancels it any more. It used to live in the TUI, where looking away
	 * cancelled it; here a session opened and abandoned starts anyway two
	 * seconds later. That is the correct reading — the wait was never about
	 * whether anyone was watching — but it does mean a mistaken open can no
	 * longer be un-opened by being fast.
	 *
	 * Which is also why only a delay-free start can hand a failure back. Once the
	 * timer is armed the request is over and there is no status code left to
	 * answer with; what the provider says then is in the ring and on the next
	 * `session` frame, and null here means "nothing has gone wrong yet", not
	 * "this worked".
	 */
	const spawn = (
		sessionId: string,
		argv: string[],
		cwd: string,
		delayMs: number,
		env?: Readonly<Record<string, string>>,
	): Error | null => {
		const entry = registry.get(sessionId);
		if (!entry) return null;

		if (delayMs > 0) {
			entry.timer = setTimeout(() => {
				launch(sessionId, entry, argv, cwd, env);
			}, delayMs);
			return null;
		}

		return launch(sessionId, entry, argv, cwd, env);
	};

	/**
	 * SIGTERM, a grace, then SIGKILL if it was not taken.
	 *
	 * Its own function because two callers need exactly this and one of them is
	 * not allowed to wait for it: a `disband` that only asked politely would
	 * leave the impolite half of the CLIs running with nothing left that knows
	 * they exist.
	 */
	const stop = async (child: ReturnType<typeof Bun.spawn>): Promise<void> => {
		signalGroup(child, "SIGTERM");
		await Promise.race([child.exited, Bun.sleep(GRACE_MS)]);

		if (child.exitCode === null && child.signalCode === null) {
			signalGroup(child, "SIGKILL");
		}

		await child.exited;
	};

	/**
	 * Ends one session's process, on purpose, and leaves its screen behind.
	 *
	 * The entry survives: what the agent last printed is the thing someone came
	 * back to read, and a kill that also forgot it would make "stop this" and
	 * "close this" the same button.
	 */
	const kill = async (sessionId: string): Promise<void> => {
		const entry = registry.get(sessionId);
		if (!entry) return;

		if (entry.timer) {
			clearTimeout(entry.timer);
			entry.timer = null;
		}

		const child = entry.child;

		if (!child) {
			// claimed, or waiting out a settling time that has just been cancelled:
			// there is no process, and leaving it `starting` would refuse every
			// later start on behalf of one that is never coming. `stopped` and not
			// `never-started`, because a client reads `never-started` as an
			// invitation to POST a terminal — answering it to whoever just asked
			// for the agent to stop is how stopping the agent started it.
			if (entry.state === "starting") {
				entry.state = "stopped";
				// the same blank slate the other branch reaches through the exit
				// hook. There is no child here, but there can still be a previous
				// run's screen in the ring, and "stopped" has to look the same
				// however it was arrived at.
				wipe(entry);
				announce(entry);
			}
			return;
		}

		// Before the signal, because the exit hook is what reads it and the child
		// may be gone before the next line runs.
		entry.hibernating = true;

		await stop(child);
	};

	/**
	 * The row is gone, so the session is: end it, farewell frame, close, forget.
	 *
	 * Called after the delete and never instead of it. The clients are told with
	 * words because a close code is not readable from the WebSocket API on the
	 * other side in any form the pane can print.
	 */
	const disband = (sessionId: string): void => {
		const entry = registry.get(sessionId);
		if (!entry) return;

		registry.delete(sessionId);

		// The entry is the last thing that knows about these, so they go with it. A
		// start landing in `removeSession`'s kill-then-delete window installs a
		// child or a settling timer on an entry this is about to forget, and a
		// forgotten child is in no map, has no row left to name its pid, and is
		// reachable by no sweep at any later boot — which is the exact orphan the
		// kill-then-delete ordering exists to rule out.
		if (entry.timer) clearTimeout(entry.timer);
		if (entry.child) void stop(entry.child);

		for (const ws of entry.clients) {
			feeds.delete(ws);
			if (ws.readyState !== 1) continue;

			ws.send(
				JSON.stringify({ t: "error", reason: "this session was removed" }),
			);
			ws.close(CLOSE_REMOVED, "removed");
		}
	};

	/**
	 * Whether there is a row to attach to at all, asked the cheap way.
	 *
	 * Null is the third answer and it is not pedantry: this used to report a
	 * database that would not answer as a session that does not exist, and the
	 * client treats "no such session" as permanent — it closes the attachment and
	 * never dials again for the life of the process. Any concurrent writer on the
	 * file is enough to produce it (`db:studio` is documented against this exact
	 * database), so one second of SQLITE_BUSY bought a pane that was dead until
	 * the TUI was restarted, on a session that was there the whole time.
	 */
	const known = (sessionId: string): boolean | null => {
		try {
			return (
				db
					.select({ id: sessions.id })
					.from(sessions)
					.where(eq(sessions.id, sessionId))
					.get() !== undefined
			);
		} catch (cause) {
			// the only raw database read in the daemon, so it is also the only one
			// whose failure would otherwise be invisible in the logs
			void run(Console.error(`terminals/known failed: ${cause}`));
			return null;
		}
	};

	/**
	 * The history this client is owed, in frames.
	 *
	 * A reconnect that names the stream it holds and how far into it it got is
	 * resumed byte-exactly from there; anything else — a different process, an
	 * offset older than the ring, a client that never saw this session — gets
	 * everything still kept. That is what makes switching panes free and makes a
	 * lossy replay the restart-only path rather than the normal one.
	 */
	const history = (
		entry: Live,
		data: AttachData,
	): { from: number; frames: Uint8Array[]; truncated: boolean } => {
		const resuming =
			data.stream === entry.streamId &&
			data.since !== null &&
			data.since >= entry.ringFrom &&
			data.since <= entry.offset;

		const from = resuming && data.since !== null ? data.since : entry.ringFrom;
		const frames: Uint8Array[] = [];

		let at = entry.ringFrom;

		for (const chunk of entry.ring) {
			const end = at + chunk.byteLength;

			if (end > from) {
				const slice = at >= from ? chunk : chunk.subarray(from - at);
				for (let i = 0; i < slice.byteLength; i += CHUNK) {
					frames.push(slice.subarray(i, i + CHUNK));
				}
			}

			at = end;
		}

		return { from, frames, truncated: !resuming && entry.truncated };
	};

	/**
	 * A client arrives: what this is, what has happened, then what happens next.
	 *
	 * Attach never starts anything. A session that has never run says so and the
	 * client decides whether to POST a terminal; a session that ended says so and
	 * keeps its last screen. Restarting on the first glance is what the old TUI
	 * did, and once the daemon keeps a crashed agent's final words, doing it
	 * again would destroy the thing the visit was for.
	 */
	const attach = (ws: ServerWebSocket<AttachData>): void => {
		const { sessionId } = ws.data;

		let entry = registry.get(sessionId);

		if (!entry) {
			const there = known(sessionId);

			if (there === null) {
				ws.send(
					JSON.stringify({ t: "error", reason: "the database did not answer" }),
				);
				ws.close(CLOSE_UNAVAILABLE, "unavailable");
				return;
			}

			if (!there) {
				ws.send(JSON.stringify({ t: "error", reason: "no such session" }));
				ws.close(CLOSE_NO_SESSION, "no such session");
				return;
			}

			entry = blank();
			registry.set(sessionId, entry);
		}

		feeds.set(ws, { items: [], bytes: 0 });
		entry.clients.add(ws);
		entry.owner ??= ws;

		const grew = resize(entry);
		const replay = history(entry, ws.data);

		ws.send(sessionFrame(entry, ws));

		// every attach is bracketed, including the empty one. A client whose
		// replay frames are sometimes absent has a second path through its own
		// state machine, and the rare path is the one that stays broken.
		//
		// Through the feed and not straight to the socket, unlike the session
		// frame above it: the bracket is part of the byte stream's ordering and
		// the status is not.
		push(
			ws,
			JSON.stringify({
				t: "replay-begin",
				stream: entry.streamId,
				from: replay.from,
				bytes: entry.offset - replay.from,
				truncated: replay.truncated,
			}),
		);

		for (const frame of replay.frames) push(ws, frame);
		push(ws, JSON.stringify({ t: "replay-end", offset: entry.offset }));

		// the arrival changed the count everyone else is showing, and possibly
		// the size they are all drawing at
		if (entry.clients.size > 1 || grew) {
			for (const other of entry.clients) {
				if (other !== ws && other.readyState === 1) {
					other.send(sessionFrame(entry, other));
				}
			}
		}
	};

	/**
	 * A client says something.
	 *
	 * Binary is input and goes to the PTY verbatim — keys, paste, mouse, focus,
	 * and the device responses an emulator produces on its own. Only the owner's
	 * is taken: several emulators watching one stream each answer `ESC[6n`, and
	 * two cursor reports typed into an agent are worse than none. Dropping the
	 * rest silently is one rule that covers all of it.
	 */
	const message = (
		ws: ServerWebSocket<AttachData>,
		data: string | Buffer,
	): void => {
		const entry = registry.get(ws.data.sessionId);
		if (!entry) return;

		if (typeof data !== "string") {
			if (entry.owner !== ws) return;
			entry.child?.terminal?.write(data);
			return;
		}

		const note = parse(data);
		if (!note) return;

		if (note.t === "claim") {
			// last claim wins, and it is the client saying "I am the one being
			// typed at", which is a thing only it can know
			entry.owner = ws;
			announce(entry);
			return;
		}

		if (note.t === "size") {
			// bounded here rather than trusted, the same as the query string the
			// attach route parses. `{"cols":1000000}` used to be written into the
			// entry and then thrown out of this callback by the PTY's own resize,
			// which left the recorded size and the real one permanently apart with
			// no frame sent to say so.
			ws.data.cols = viewport(note.cols);
			ws.data.rows = viewport(note.rows);
			if (resize(entry)) announce(entry);
		}
	};

	/**
	 * A client goes. The session does not.
	 *
	 * Ownership is attachment-scoped and never vacated while anyone is left: the
	 * oldest remaining client takes it. Tying it to whoever has focus would
	 * leave `owner` null every time someone opened a modal, and the daemon would
	 * then drop *everyone's* device responses — hanging an agent that asked
	 * `ESC[6n` on an answer nobody was permitted to send.
	 */
	const detach = (ws: ServerWebSocket<AttachData>): void => {
		feeds.delete(ws);

		const entry = registry.get(ws.data.sessionId);
		if (!entry) return;

		if (!entry.clients.delete(ws)) return;

		if (entry.owner === ws) {
			entry.owner = entry.clients.values().next().value ?? null;
		}

		// a session nobody ever started and nobody is watching is not a session,
		// it is a row someone opened a socket to once. `stopped` is deliberately
		// not this case: forgetting it would have the next client told
		// `never-started` and start the agent somebody had just asked to stop.
		if (entry.state === "never-started" && entry.clients.size === 0) {
			registry.delete(ws.data.sessionId);
			return;
		}

		resize(entry);
		announce(entry);
	};

	const drain = (ws: ServerWebSocket<AttachData>): void => pump(ws);

	/** What the roster and the routes are allowed to ask about one session. */
	const status = (
		sessionId: string,
	): { pid: number | null; state: Live["state"] } | null => {
		const entry = registry.get(sessionId);
		if (!entry) return null;

		return { pid: entry.child?.pid ?? null, state: entry.state };
	};

	/**
	 * A stored row with what the registry knows written over the top of it.
	 *
	 * The Map is the authority and this is the door to it. A row's `pid` column
	 * is a projection written a moment later; reading the registry instead is
	 * what makes the answer true rather than merely fresh.
	 *
	 * `state` is here because the pid on its own cannot say "coming up", and a
	 * roster with only the pid to read paints a session dead for the whole of its
	 * provider's settling window — two seconds, while codex had one, on a
	 * session that was opened successfully and about to answer. A row that
	 * reads dead for two seconds is a row that lies.
	 */
	const overlay = (row: Session): LiveSession => {
		const entry = registry.get(row.id);

		return {
			...row,
			pid: entry?.child?.pid ?? row.pid,
			state: entry?.state ?? "never-started",
		};
	};

	/**
	 * Every agent, on purpose, before the daemon goes.
	 *
	 * Most of them would die anyway — the masters close with us and the kernel
	 * SIGHUPs each foreground group — but "most" is measurably not all: a child
	 * that ignores HUP and never touches its tty survives it, reparented to
	 * init, and from then on only the pid on the row can reach it. Killing them
	 * here is what keeps that path rare enough to be a boot-time repair rather
	 * than the normal case.
	 *
	 * The rows are cleared after the kills and not before: this runs while the
	 * database is still open — sqlite closes after us, because the scope that
	 * built it opened first and scopes close LIFO — and a row still naming a pid
	 * is the only thing that would let the next boot find a survivor.
	 */
	const reap = async (): Promise<number> => {
		const doomed = [...registry.entries()].flatMap(([sessionId, entry]) =>
			entry.child ? [{ sessionId, child: entry.child }] : [],
		);

		for (const entry of registry.values()) {
			if (entry.timer) clearTimeout(entry.timer);
		}

		registry.clear();
		feeds.clear();

		for (const { child } of doomed) signalGroup(child, "SIGTERM");

		// one clock for all of them: the grace is the shutdown's, not each
		// child's, so ten agents still cost two seconds and not twenty
		const grace = Bun.sleep(GRACE_MS);

		await Promise.all(
			doomed.map(({ child }) => Promise.race([child.exited, grace])),
		);

		for (const { child } of doomed) {
			if (child.exitCode === null && child.signalCode === null) {
				signalGroup(child, "SIGKILL");
			}
		}

		if (doomed.length > 0) await clearPids(doomed.map((it) => it.sessionId));

		return doomed.length;
	};

	// `registry` goes out with the methods for the same reason `Database` hands
	// out `sqlite` next to `db`: the methods are the door, but what is behind
	// them is not a secret, and a shutdown whose whole job is to kill things has
	// to be testable from outside by something that can put a child in it.
	return {
		registry,
		claimStart,
		abandon,
		spawn,
		kill,
		disband,
		attach,
		message,
		detach,
		drain,
		status,
		overlay,
		reap,
	};
});

/**
 * One dimension of a client's viewport, as far as the daemon will believe it.
 *
 * Exported so the attach route's query string and the `size` frame are bounded
 * by the same function: they are the same claim arriving through two doors, and
 * a bound only one of them applied would be a bound the other could walk around.
 * Zero is a real answer and means "not showing this anywhere", which withdraws
 * the client from the size vote.
 */
export const viewport = (value: unknown): number => {
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0) return 0;

	return Math.min(Math.floor(n), MAX_DIMENSION);
};

/** Anything unparseable is noise on a socket, not an error worth a frame. */
const parse = (
	text: string,
): { t?: string; cols?: unknown; rows?: unknown } | null => {
	try {
		return JSON.parse(text) as { t?: string };
	} catch {
		return null;
	}
};

export class Terminals extends Effect.Service<Terminals>()(
	"magents/Terminals",
	{
		scoped: Effect.acquireRelease(acquire, (terminals) =>
			Effect.promise(() => terminals.reap()).pipe(
				// the one line this file prints. Killing a user's agents is the thing
				// the daemon does on the way out that it should have to say out loud
				Effect.flatMap((reaped) => Console.log(`  reaped    ${reaped}`)),
			),
		),
	},
) {}
