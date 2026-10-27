import { eq } from "drizzle-orm";
import { Effect } from "effect";
import type { Group } from "../db/schema";
import { groups } from "../db/schema";
import { DatabaseError } from "../errors/database-error";
import { asGroup } from "../lib/as-group";
import { Database } from "./database";

/**
 * Every group, or every group in one project, in the order somebody put them
 * in.
 *
 * By `position`, which is a fractional index — see the schema. It was `id`,
 * which for UUIDv7 means the order they were made in, and that was the right
 * default while there was no way to say anything else: a list that re-sorts
 * itself when a bucket is renamed is a list whose rows move under the cursor,
 * so the order had to come from somewhere that a rename could not touch.
 * Creation order is still where a new group lands. It is just no longer the
 * only order available.
 *
 * The project leads the sort in the unnarrowed case so that each one's buckets
 * arrive together — the roster paints them under their own heading, and it is
 * the same pair of columns the index is built on, so the database walks it
 * rather than sorting anything.
 */
export const listGroups = (
	projectId?: string,
): Effect.Effect<Group[], DatabaseError, Database> =>
	Effect.gen(function* () {
		const { db } = yield* Database;

		const rows = yield* Effect.try({
			try: () => {
				const query = db.select().from(groups);
				return projectId
					? query
							.where(eq(groups.projectId, projectId))
							.orderBy(groups.position)
							.all()
					: query.orderBy(groups.projectId, groups.position).all();
			},
			catch: (cause) => new DatabaseError({ operation: "listGroups", cause }),
		});

		return rows.map(asGroup);
	});

/**
 * Where a project's new sessions are born, or null when it has said nothing.
 *
 * Null is the ordinary answer and not a gap: a project with no groups is every
 * project as this shipped, and its sessions hang directly off it.
 */
export const defaultGroup = (
	projectId: string,
): Effect.Effect<Group | null, DatabaseError, Database> =>
	Effect.gen(function* () {
		const { db } = yield* Database;

		const row = yield* Effect.try({
			try: () =>
				db
					.select()
					.from(groups)
					.where(eq(groups.projectId, projectId))
					.all()
					.find((group) => group.isDefault),
			catch: (cause) => new DatabaseError({ operation: "defaultGroup", cause }),
		});

		return row ? asGroup(row) : null;
	});
