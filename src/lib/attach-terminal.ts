import { hashKey } from "@tanstack/react-query";
import {
	CLOSE_NO_SESSION,
	type ReplayBeginFrame,
	type ReplayEndFrame,
	type SessionFrame,
} from "../../daemon/lib/attach-frames";
import { socketPath } from "../../daemon/paths/socket-path";
import { healthQuery } from "../queries/health-query";
import { queryClient } from "../queries/query-client";

/**
 * One socket onto one session's terminal, for as long as the session is open.
 *
 * A sibling of `request.ts` rather than a use of it: `request` awaits
 * `response.json()` unconditionally, which buffers a whole answer and can carry
 * no stream at all. This dials the same unix socket the rest of the client uses
 * — `ws+unix://` is the only door, since the `WebSocket` constructor has no
 * `unix` option and would otherwise go looking for a TCP port that does not
 * exist — and upgrades on it, so there is exactly one path in `~/.magents` and
 * one env override that can move it.
 *
 * Two frame kinds and no header bytes. Binary is PTY output going out and key
 * bytes coming back; text is one JSON object with a `t` discriminant. The
 * WebSocket keeps them in order relative to each other, which is why replay can
 * be bracketed by two text frames and needs no sequence numbers.
 *
 * Reconnecting is this file's other job and it is deliberately not eager: the
 * backoff is gated on the heartbeat's health query, so a daemon that is not
 * running is dialled once and then not again until the beat says it answered.
 * A retry loop of its own would be a second opinion about whether the backend
 * is up, and `daemon-status.tsx` spends a paragraph on what that costs — two
 * things asking the same question drift, and the one nobody is watching is the
 * one that is wrong.
 *
 * The frame shapes and the close codes are `daemon/lib/attach-frames.ts`, so
 * this file reads the protocol rather than restating it.
 */

/**
 * The protocol, handed on from the client that speaks it.
 *
 * `daemon/lib/attach-frames.ts` is where these are declared and the only place
 * they are — this is a door, not a second copy. A file in `src/` that talks to
 * an attachment can take the client and its vocabulary from one import instead
 * of reaching across the tree for the halves separately.
 */
export type {
	ReplayBeginFrame,
	ReplayEndFrame,
	SessionFrame,
} from "../../daemon/lib/attach-frames";

/** Where the backoff starts, and where it stops climbing. */
const FIRST_RETRY_MS = 250;
const LAST_RETRY_MS = 2_000;

/**
 * How long to leave a "no such session" alone before asking again.
 *
 * Not a permanent answer, however final it sounds. The daemon reads the row
 * from inside the socket's open handler, and a database that is momentarily
 * busy — `db:studio` on the same file is enough — comes back as 4404 for a
 * session that plainly exists. This client used to take that once and never
 * dial again for the life of the process, which left a permanently dead pane
 * on a live agent. Retrying every two seconds would be this client insisting
 * it knows better; a pane that asks again in half a minute costs nothing and
 * recovers on its own.
 */
const DOUBTED_RETRY_MS = 30_000;

export interface Attachment {
	/** keys, paste, mouse, and the device responses the emulator produces */
	send(bytes: Uint8Array): void;
	/** this client's viewport; 0×0 withdraws it from the size vote */
	size(cols: number, rows: number): void;
	/** take the write token */
	claim(): void;
	/** stop, and stop reconnecting */
	close(): void;
}

export interface AttachHandlers {
	onSession(frame: SessionFrame): void;
	onReplayBegin(frame: ReplayBeginFrame): void;
	onOutput(bytes: Uint8Array): void;
	onReplayEnd(frame: ReplayEndFrame): void;
	onError(reason: string): void;
	onClosed(code: number): void;
	/**
	 * Where this client stands, asked at dial time rather than held here.
	 *
	 * The answer changes while the socket is down — the pane can be unmounted,
	 * resized, or fed nothing at all — and the registry is the only thing that
	 * knows. Caching it here would reconnect with the size and offset of the
	 * moment the connection dropped.
	 */
	cursor(): {
		stream: string | null;
		since: number | null;
		cols: number;
		rows: number;
	};
}

export function attachTerminal(
	sessionId: string,
	handlers: AttachHandlers,
): Attachment {
	let socket: WebSocket | null = null;
	let retry: ReturnType<typeof setTimeout> | null = null;
	let wait = FIRST_RETRY_MS;
	let done = false;

	/**
	 * Whether this client has asked for the write token, ever.
	 *
	 * Kept rather than fired and forgotten, because the socket that carried the
	 * ask is routinely not the socket that is up. `claim()` runs from the pane's
	 * focus effect at mount time, while this connection is still CONNECTING, so
	 * the send was dropped and a second window could never take the keyboard —
	 * measured: its keys reached the agent not at all, and nothing said why. And
	 * the daemon reassigns the token when an owner drops, so a blip would hand
	 * the keyboard to whichever client happened to be older.
	 */
	let claimed = false;

	/**
	 * The heartbeat's answer, not one of our own.
	 *
	 * Pending counts as reachable: at startup nothing has asked yet, and the
	 * first dial is a cheaper way to find out than waiting a beat and a half to
	 * be told. Only a health query that actually failed holds the backoff.
	 */
	const reachable = (): boolean =>
		queryClient.getQueryState(healthQuery.queryKey)?.status !== "error";

	const schedule = (): void => {
		if (done || retry) return;

		retry = setTimeout(dial, wait);
		wait = Math.min(wait * 2, LAST_RETRY_MS);
	};

	/** One socket's ending, whichever way it arrived, counted once. */
	const dropped = (ws: WebSocket, code: number): void => {
		if (socket !== ws) return;

		socket = null;

		// The one answer this client does not take at face value; the constant
		// above says why it is doubted rather than believed.
		if (code === CLOSE_NO_SESSION) wait = DOUBTED_RETRY_MS;

		handlers.onClosed(code);
		schedule();
	};

	function dial(): void {
		retry = null;
		if (done) return;

		// Nothing to dial and no point pretending otherwise. The subscription
		// below is what starts this again, on the beat that finds the daemon.
		if (!reachable()) {
			wait = FIRST_RETRY_MS;
			return;
		}

		const cursor = handlers.cursor();
		const query = new URLSearchParams({
			cols: String(cursor.cols),
			rows: String(cursor.rows),
		});
		if (cursor.stream) query.set("stream", cursor.stream);
		if (cursor.since !== null) query.set("since", String(cursor.since));

		let ws: WebSocket;

		try {
			ws = new WebSocket(
				`ws+unix://${socketPath}:/sessions/${sessionId}/attach?${query}`,
			);
		} catch {
			// a socket file that is not there fails here rather than on an event,
			// and it is the same failure as a connection refused
			schedule();
			return;
		}

		ws.binaryType = "arraybuffer";
		socket = ws;

		ws.onopen = () => {
			wait = FIRST_RETRY_MS;

			// The viewport went out on the query string, written before this socket
			// existed — and a pane's first layout lands in exactly that gap, so the
			// number the daemon has is routinely the one from before there was
			// anything on screen. Measured: a fresh 80×20 pane left its agent at the
			// 120×32 default for the life of the session, because the `size` frame
			// the layout produced was sent at a socket that was still connecting and
			// nothing ever said it again. Restating it here is cheap and it is the
			// first moment this client can be heard.
			const open = handlers.cursor();
			ws.send(JSON.stringify({ t: "size", cols: open.cols, rows: open.rows }));

			// and the claim for the same reason, one line further along the same
			// argument: it is a standing fact about this client, not an event that
			// happened once on a socket that has since gone.
			if (claimed) ws.send(JSON.stringify({ t: "claim" }));
		};

		ws.onmessage = (event) => {
			if (typeof event.data !== "string") {
				handlers.onOutput(new Uint8Array(event.data as ArrayBuffer));
				return;
			}

			const frame = parse(event.data);
			if (!frame) return;

			if (frame.t === "session") handlers.onSession(frame as SessionFrame);
			else if (frame.t === "replay-begin") {
				handlers.onReplayBegin(frame as unknown as ReplayBeginFrame);
			} else if (frame.t === "replay-end") {
				handlers.onReplayEnd(frame as unknown as ReplayEndFrame);
			} else if (frame.t === "error") {
				handlers.onError(
					typeof frame.reason === "string"
						? frame.reason
						: "the daemon refused this attachment",
				);
			}
		};

		// error and close both arrive for a connection that never opened, and
		// neither is guaranteed to be second; `dropped` is written to be the one
		// that counts and the other to be a no-op
		ws.onerror = () => dropped(ws, 1006);
		ws.onclose = (event) => dropped(ws, event.code);
	}

	const health = hashKey(healthQuery.queryKey);

	const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
		if (done || socket || retry) return;
		if (event.query.queryHash !== health) return;
		if (event.query.state.status !== "success") return;

		wait = FIRST_RETRY_MS;
		dial();
	});

	dial();

	return {
		// Dropped rather than queued while the socket is down, and that is the
		// honest reading of a keystroke: it was typed at a program that was not
		// listening. Holding it would deliver a burst of stale keys into an agent
		// that has redrawn since, which is worse than losing them.
		send: (bytes) => {
			if (socket?.readyState === WebSocket.OPEN) socket.send(bytes);
		},
		size: (cols, rows) => {
			if (socket?.readyState === WebSocket.OPEN) {
				socket.send(JSON.stringify({ t: "size", cols, rows }));
			}
		},
		claim: () => {
			claimed = true;
			if (socket?.readyState === WebSocket.OPEN) {
				socket.send(JSON.stringify({ t: "claim" }));
			}
		},
		close: () => {
			done = true;
			if (retry) clearTimeout(retry);
			retry = null;
			unsubscribe();

			// cleared first, so the `close` event this causes finds nothing to
			// report: a detach is not a drop and must not wake the backoff
			const ws = socket;
			socket = null;
			ws?.close(1000, "detached");
		},
	};
}

/** Anything unparseable is noise on a socket, not a failure worth reporting. */
const parse = (text: string): { t?: string; reason?: unknown } | null => {
	try {
		return JSON.parse(text) as { t?: string };
	} catch {
		return null;
	}
};
