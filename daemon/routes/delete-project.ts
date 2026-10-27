import { Effect, Option } from "effect";
import type { Database } from "../services/database";
import { removeProject } from "../services/remove-project";

/**
 * `DELETE /projects/:id` — the project, and its sessions with it.
 *
 * A miss is a 404 rather than a quiet 204. The only caller is a screen deleting
 * something it just listed, so "that project is not here" means the list it is
 * showing is out of date, and saying so is more use than pretending it worked.
 */
export const deleteProject = (
	id: string,
): Effect.Effect<Response, never, Database> =>
	removeProject(id).pipe(
		Effect.map(
			Option.match({
				onNone: () =>
					Response.json({ error: "no such project" }, { status: 404 }),
				onSome: (project) => Response.json(project),
			}),
		),
		Effect.catchTag("DatabaseError", (error) =>
			Effect.succeed(
				Response.json({ error: `${error.operation} failed` }, { status: 500 }),
			),
		),
	);
