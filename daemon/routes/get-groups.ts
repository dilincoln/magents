import { Effect } from "effect";
import type { Database } from "../services/database";
import { listGroups } from "../services/list-groups";

/** `GET /groups[?project=<id>]` — the buckets, in the order they are kept in. */
export const getGroups = (
	projectId: string | null,
): Effect.Effect<Response, never, Database> =>
	listGroups(projectId ?? undefined).pipe(
		Effect.map((groups) => Response.json(groups)),
		Effect.catchTag("DatabaseError", (error) =>
			Effect.succeed(
				Response.json({ error: `${error.operation} failed` }, { status: 500 }),
			),
		),
	);
