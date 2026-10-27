import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import type { Group } from "../db/schema";
import { groups } from "../db/schema";
import { DatabaseError } from "../errors/database-error";
import { asGroup } from "../lib/as-group";
import { Database } from "./database";

/**
 * Drops a bucket. The sessions in it are not touched.
 *
 * That is the column's doing rather than this function's — `sessions.group_id`
 * is `on delete set null` — and it is worth knowing here because it is the
 * whole risk of the operation. Removing a group looks destructive next to
 * removing a project, which takes its sessions with it, and it is not: the
 * conversations land back where every session was before anybody made a group,
 * loose under the project.
 */
export const removeGroup = (
	id: string,
): Effect.Effect<Option.Option<Group>, DatabaseError, Database> =>
	Effect.gen(function* () {
		const { db } = yield* Database;

		const row = yield* Effect.try({
			try: () => db.delete(groups).where(eq(groups.id, id)).returning().get(),
			catch: (cause) => new DatabaseError({ operation: "removeGroup", cause }),
		});

		return Option.fromNullable(row).pipe(Option.map(asGroup));
	});
