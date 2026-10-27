import { Effect } from "effect";
import { Terminals } from "../services/terminals";

/**
 * `DELETE /sessions/:id/terminal` — stop the agent, keep the session.
 *
 * The row is not touched and neither is what the process printed: stopping is
 * not forgetting, and the screen a killed agent left behind is the thing
 * somebody comes back to read. Removing the session itself is
 * `DELETE /sessions/:id`, which kills this way first and then deletes.
 *
 * A miss is a 404 for the same reason it is everywhere else here — the caller
 * is acting on a list, and "there was never anything running" means that list
 * is out of date.
 */
export const deleteSessionTerminal = (
	id: string,
): Effect.Effect<Response, never, Terminals> =>
	Effect.gen(function* () {
		const terminals = yield* Terminals;

		if (!terminals.status(id)) {
			return Response.json(
				{ error: "no terminal for that session" },
				{ status: 404 },
			);
		}

		// awaited, unlike a spawn: the answer is meant to be readable as "it is
		// stopped now", and the grace it may spend is two seconds at worst
		yield* Effect.promise(() => terminals.kill(id));

		return Response.json(terminals.status(id));
	});
