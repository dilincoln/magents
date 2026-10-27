import { Effect } from "effect";
import type { Database } from "../services/database";
import { listProjects } from "../services/list-projects";

/** `GET /projects` — every registered project, oldest first. */
export const getProjects: Effect.Effect<Response, never, Database> =
	listProjects.pipe(
		Effect.map((projects) => Response.json(projects)),
		Effect.catchTag("DatabaseError", (error) =>
			Effect.succeed(
				Response.json({ error: `${error.operation} failed` }, { status: 500 }),
			),
		),
	);
