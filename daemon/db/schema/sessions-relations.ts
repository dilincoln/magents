import { relations } from "drizzle-orm";
import { groups } from "./groups";
import { projects } from "./projects";
import { sessions } from "./sessions";

export const sessionsRelations = relations(sessions, ({ one }) => ({
	project: one(projects, {
		fields: [sessions.projectId],
		references: [projects.id],
	}),
	group: one(groups, {
		fields: [sessions.groupId],
		references: [groups.id],
	}),
}));
