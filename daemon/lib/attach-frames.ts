/**
 * The attach socket's wire protocol, written once for both sides of it.
 *
 * The daemon emits these frames and the TUI reads them, and until this file
 * existed each side carried its own hand-written copy — including the close
 * codes, which `session-terminals.ts` re-declared under a comment saying "see
 * the daemon". Adding a field on one side broke nothing and compiled fine,
 * which is the wrong property for the one contract with no compiler holding it.
 * The convention is already here: `src/lib/agents.ts` re-exports `ProviderId`
 * from this side rather than redeclaring it, for the same reason.
 *
 * Types and constants only, and deliberately no imports at all. The TUI links
 * whatever it imports into its own process — that is why `detail-pane.tsx`
 * dropped the `adapters` import when the providers moved daemon-side — so a
 * shared module that reached for anything with a runtime would quietly undo it.
 *
 * Both sides import it, and that is the part worth checking rather than
 * assuming. It landed for a while with only the TUI reading it while
 * `terminals.ts` kept its own declarations, which made this a third copy
 * wearing the name of the fix — and it had already drifted: the daemon emitted
 * a `stopped` state this file did not list.
 */

/**
 * Where one session's process is, in the words every route, row and frame uses.
 *
 * `stopped` is not a synonym for `never-started` and the difference is the bug
 * that put it here: stopping an agent inside its provider's settling window used
 * to leave the entry saying it had never run, which is the one answer a pane
 * reads as an invitation to start it. Asking for it to stop started it.
 */
export type TerminalState =
	| "never-started"
	| "starting"
	| "running"
	| "exited"
	| "stopped";

/** Where a session's process is, whole, on every change to any field. */
export interface SessionFrame {
	t: "session";
	state: TerminalState;
	pid: number | null;
	exit: { code: number | null; signal: string | null } | null;
	/** this process's byte stream; a new one means the screen is a new program's */
	stream: string;
	/** the agreed PTY size, which is the smallest attached client's */
	cols: number;
	rows: number;
	clients: number;
	/** whether this connection is the one allowed to type */
	owner: boolean;
}

/** History starts here; every binary frame until `replay-end` is the past. */
export interface ReplayBeginFrame {
	t: "replay-begin";
	stream: string;
	/** the stream offset the first replayed byte sits at */
	from: number;
	bytes: number;
	/** the ring's head was evicted, so what follows begins mid-conversation */
	truncated: boolean;
}

export interface ReplayEndFrame {
	t: "replay-end";
	/** where the client is caught up to, and what it sends back as `since` */
	offset: number;
}

/**
 * The daemon's own sentence, always sent before any close.
 *
 * A non-101 response carries no words to a WebSocket client — refusing the
 * upgrade with a JSON body gives it exactly `Expected 101 status code` — so a
 * refusal is a frame first and a code second.
 */
export interface ErrorFrame {
	t: "error";
	reason: string;
}

export type DaemonFrame =
	| SessionFrame
	| ReplayBeginFrame
	| ReplayEndFrame
	| ErrorFrame;

/** This client's viewport; 0×0 withdraws it from the size vote. */
export interface SizeFrame {
	t: "size";
	cols: number;
	rows: number;
}

/** Take the write token. Last claim wins, and only the owner's bytes are read. */
export interface ClaimFrame {
	t: "claim";
}

export type ClientFrame = SizeFrame | ClaimFrame;

/** No such session row — or a database that would not answer for it. */
export const CLOSE_NO_SESSION = 4404;

/** This client's send buffer passed the slow-client cutoff. */
export const CLOSE_TOO_SLOW = 4408;

/** The session row was removed out from under it. */
export const CLOSE_REMOVED = 4410;

/**
 * The daemon could not answer for this session — a database that would not read.
 *
 * Distinct from 4404 because only 4404 and 4410 are final: the client stops
 * dialling on those and comes back from everything else. Saying "no such
 * session" about a locked sqlite file cost a pane the rest of the process's
 * life over a fault that lasted a second.
 */
export const CLOSE_UNAVAILABLE = 4503;
