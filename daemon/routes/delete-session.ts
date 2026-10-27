import { Effect, Option } from "effect";
import type { Database } from "../services/database";
import { removeSession } from "../services/remove-session";
import type { Terminals } from "../services/terminals";

/**
 * `DELETE /sessions/:id` — the row, and nothing else.
 *
 * A miss is a 404 rather than a quiet 204, the same as a project: the only
 * caller is a screen deleting something it just listed, so "not here" means the
 * list is out of date and saying so is more use than pretending it worked.
 */
export const deleteSession = (
	id: string,
): Effect.Effect<Response, never, Database | Terminals> =>
	removeSession(id).pipe(
		Effect.map(
			Option.match({
				onNone: () =>
					Response.json({ error: "no such session" }, { status: 404 }),
				onSome: (session) => Response.json(session),
			}),
		),
		Effect.catchTag("DatabaseError", (error) =>
			Effect.succeed(
				Response.json({ error: `${error.operation} failed` }, { status: 500 }),
			),
		),
	);
