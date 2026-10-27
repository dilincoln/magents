import type { Group } from "../daemon/db/schema";
import { request } from "./request";

/**
 * Drops a bucket. The sessions in it survive and go back to hanging directly
 * off the project — `sessions.group_id` is `on delete set null`, so this is
 * nothing like removing a project.
 */
export const removeGroup = (id: string): Promise<Group> =>
	request(`/groups/${id}`, { method: "DELETE" });
