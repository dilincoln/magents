import { relations } from "drizzle-orm";
import { groups } from "./groups";
import { projects } from "./projects";
import { sessions } from "./sessions";

export const groupsRelations = relations(groups, ({ one, many }) => ({
	project: one(projects, {
		fields: [groups.projectId],
		references: [projects.id],
	}),
	sessions: many(sessions),
}));
