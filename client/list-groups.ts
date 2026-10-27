import type { Group } from "../daemon/db/schema";
import { request } from "./request";

/**
 * Every group, or every group in one project.
 *
 * Not narrowed by default, for the reason `listSessions` is not: the roster
 * paints every project at once, so one list fetched once beats a query per
 * project. The parameter is for the CLI, which is usually asking about one.
 */
export const listGroups = (projectId?: string): Promise<Group[]> =>
	request(
		projectId ? `/groups?project=${encodeURIComponent(projectId)}` : "/groups",
	);
