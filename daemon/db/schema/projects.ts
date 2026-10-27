import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => Bun.randomUUIDv7()),

	/**
	 * The folder the project lives in. Never written by a caller: `createProject`
	 * derives it from the path, so it cannot drift from the directory it names.
	 */
	name: text("name").notNull(),

	/** Absolute, no trailing slash. One project per path. */
	path: text("path").notNull().unique(),
});

export type Project = typeof projects.$inferSelect;
