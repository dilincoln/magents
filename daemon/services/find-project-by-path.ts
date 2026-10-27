import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import type { Project } from "../db/schema";
import { projects } from "../db/schema";
import { DatabaseError } from "../errors/database-error";
import { normalizePath } from "../lib/normalize-path";
import { Database } from "./database";

/**
 * `Option` rather than `Project | undefined`: a miss is an ordinary outcome
 * here, not a failure, and the caller has to say what it does about it.
 */
export const findProjectByPath = (
	path: string,
): Effect.Effect<Option.Option<Project>, DatabaseError, Database> =>
	Effect.gen(function* () {
		const { db } = yield* Database;

		const row = yield* Effect.try({
			try: () =>
				db
					.select()
					.from(projects)
					.where(eq(projects.path, normalizePath(path)))
					.get(),
			catch: (cause) =>
				new DatabaseError({ operation: "findProjectByPath", cause }),
		});

		return Option.fromNullable(row);
	});
