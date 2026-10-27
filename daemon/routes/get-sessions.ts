import { Effect } from "effect";
import type { Database } from "../services/database";
import { listSessions } from "../services/list-sessions";
import type { Terminals } from "../services/terminals";

/** `GET /sessions`, or `/sessions?project=<id>` for one project's. */
export const getSessions = (
	projectId: string | null,
): Effect.Effect<Response, never, Database | Terminals> =>
	listSessions(projectId ?? undefined).pipe(
		Effect.map((sessions) => Response.json(sessions)),
		Effect.catchTag("DatabaseError", (error) =>
			Effect.succeed(
				Response.json({ error: `${error.operation} failed` }, { status: 500 }),
			),
		),
	);
