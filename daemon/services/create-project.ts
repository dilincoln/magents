import { Effect } from "effect";
import type { Project } from "../db/schema";
import { projects } from "../db/schema";
import { DatabaseError } from "../errors/database-error";
import { folderOf } from "../lib/folder-of";
import { normalizePath } from "../lib/normalize-path";
import { Database } from "./database";

/**
 * Registers a project by its path. The name is never an argument — it is the
 * folder, derived here, so it cannot drift from the directory it claims to be.
 *
 * Idempotent on purpose: callers register on every startup, so a known path has
 * to return the existing row rather than throw.
 */
export const createProject = (
	path: string,
): Effect.Effect<Project, DatabaseError, Database> =>
	Effect.gen(function* () {
		const { db } = yield* Database;
		const normalized = normalizePath(path);
		const name = folderOf(normalized);

		return yield* Effect.try({
			try: () =>
				db
					.insert(projects)
					.values({ name, path: normalized })
					.onConflictDoUpdate({ target: projects.path, set: { name } })
					.returning()
					.get(),
			catch: (cause) =>
				new DatabaseError({ operation: "createProject", cause }),
		});
	});
