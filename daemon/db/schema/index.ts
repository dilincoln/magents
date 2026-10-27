/**
 * The daemon's persistent shape: one table per file, its relations alongside it,
 * gathered here.
 *
 * Ids are UUIDv7 — time-ordered, so rows sort by creation and the primary-key
 * index appends instead of scattering writes across the B-tree the way a random
 * v4 does. `Bun.randomUUIDv7()` is native, so no dependency buys this.
 *
 * Keeping relations in their own files leaves the imports acyclic: the tables
 * know nothing about each other beyond the foreign key, which points one way,
 * and the relation files are the only place that reaches for both.
 */

import { groups } from "./groups";
import { groupsRelations } from "./groups-relations";
import { projects } from "./projects";
import { projectsRelations } from "./projects-relations";
import { sessions } from "./sessions";
import { sessionsRelations } from "./sessions-relations";

/**
 * What `drizzle()` is handed. The relations belong in here too: without them
 * `db.query.projects.findMany` has no `with` to offer.
 */
export const schemas = {
	groups,
	groupsRelations,
	projects,
	projectsRelations,
	sessions,
	sessionsRelations,
} as const;

export * from "./groups";
export * from "./groups-relations";
export * from "./projects";
// Named re-exports as well as the object: drizzle-kit reads this file looking
// for exported tables, and it does not unpack `schemas` to find them.
export * from "./projects-relations";
export * from "./sessions";
export * from "./sessions-relations";
