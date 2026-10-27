import type { Server } from "bun";
import { Effect } from "effect";
import { type AttachData, viewport } from "../services/terminals";

/**
 * `GET /sessions/:id/attach` — the one route that answers with a socket.
 *
 * Dialled as `ws+unix://<socketPath>:/sessions/<id>/attach`, on the socket that
 * already exists: there is no `unix` option on the `WebSocket` constructor, so
 * `ws+unix://` is the only door, and a second listener with hand-rolled framing
 * would have bought a measured fifteen percent on a round trip nothing here is
 * waiting on.
 *
 * **Nothing is refused here, on purpose.** The upgrade is accepted whenever the
 * path shape matches — the query string is bounded on the way past, but nothing
 * about it can turn the request down — and a session that does not exist or
 * cannot be resumed is refused in-band, after `open`, with an `error` frame. That is not
 * a shortcut: a non-101 response carries no words to a WebSocket client —
 * refusing with a 409 and a JSON body gives the other side exactly `Expected
 * 101 status code` and close code 1002, and the sentence explaining what went
 * wrong is unreachable from the WebSocket API. A frame is the only way to say
 * anything at all.
 *
 * The viewport is on the query string rather than in a first message so that a
 * fresh spawn can be sized correctly on the round trip that starts it, instead
 * of drawing one screen at the default and then reflowing.
 */
export const getSessionAttach = (
	request: Request,
	server: Server<AttachData>,
	sessionId: string,
): Effect.Effect<Response | undefined> =>
	Effect.sync(() => {
		const { searchParams } = new URL(request.url);

		const data: AttachData = {
			sessionId,
			// `viewport` is the daemon's own, shared with the `size` frame: the
			// query string and the frame are the same claim arriving through two
			// doors, and a bound applied at one of them is one the other walks
			// around
			cols: viewport(searchParams.get("cols")),
			rows: viewport(searchParams.get("rows")),
			stream: searchParams.get("stream"),
			since: since(searchParams.get("since")),
		};

		if (server.upgrade(request, { data })) return undefined;

		return Response.json(
			{ error: "expected a websocket upgrade" },
			{ status: 426 },
		);
	});

const since = (value: string | null): number | null => {
	if (value === null) return null;

	const n = Number(value);
	return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};
