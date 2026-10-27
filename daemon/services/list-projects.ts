import { Effect } from "effect";
import type { Project } from "../db/schema";
import { projects } from "../db/schema";
import { DatabaseError } from "../errors/database-error";
import { Database } from "./database";

/** Ordered by id, which for UUIDv7 means ordered by when they were registered. */
export const listProjects: Effect.Effect<Project[], DatabaseError, Database> =
	Effect.gen(function* () {
		const { db } = yield* Database;

		return yield* Effect.try({
			try: () => db.select().from(projects).orderBy(projects.id).all(),
			catch: (cause) => new DatabaseError({ operation: "listProjects", cause }),
		});
	});
