import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import type { Project } from "../db/schema";
import { projects } from "../db/schema";
import { DatabaseError } from "../errors/database-error";
import { Database } from "./database";

/**
 * Forgets a project, and with it every session that pointed at it — the foreign
 * key is `onDelete: "cascade"`, which only fires because the connection turns
 * foreign keys on.
 *
 * Nothing on disk is touched. A project row is a claim that a repository is
 * somewhere; dropping the claim is not dropping the repository.
 *
 * `Option` rather than a boolean: a caller that asked to remove a project that
 * is not there has a stale list, and that is worth telling apart from a removal
 * that happened.
 */
export const removeProject = (
	id: string,
): Effect.Effect<Option.Option<Project>, DatabaseError, Database> =>
	Effect.gen(function* () {
		const { db } = yield* Database;

		const row = yield* Effect.try({
			try: () =>
				db.delete(projects).where(eq(projects.id, id)).returning().get(),
			catch: (cause) =>
				new DatabaseError({ operation: "removeProject", cause }),
		});

		return Option.fromNullable(row);
	});
