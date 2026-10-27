import { relations } from "drizzle-orm";
import { groups } from "./groups";
import { projects } from "./projects";
import { sessions } from "./sessions";

export const projectsRelations = relations(projects, ({ many }) => ({
	sessions: many(sessions),
	groups: many(groups),
}));
