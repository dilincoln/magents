import { Effect, Option } from "effect";
import type { Database } from "../services/database";
import { removeGroup } from "../services/remove-group";

/**
 * `DELETE /groups/:id` — the bucket, and nothing that was in it.
 *
 * Unlike `DELETE /projects/:id`, which takes its sessions with it. The
 * difference is in the column rather than here — `sessions.group_id` is `on
 * delete set null` — and it is the difference worth knowing before pressing
 * this: the conversations survive and go back to hanging off the project.
 */
export const deleteGroup = (
	id: string,
): Effect.Effect<Response, never, Database> =>
	removeGroup(id).pipe(
		Effect.map(
			Option.match({
				onNone: () =>
					Response.json({ error: "no such group" }, { status: 404 }),
				onSome: (group) => Response.json(group),
			}),
		),
		Effect.catchTag("DatabaseError", (error) =>
			Effect.succeed(
				Response.json({ error: `${error.operation} failed` }, { status: 500 }),
			),
		),
	);
