import type { Group } from "../daemon/db/schema";
import { request } from "./request";

/**
 * Makes a bucket in a project.
 *
 * `default: true` makes it the project's home for new sessions, and unmakes
 * whichever one held that before — the daemon does both in one transaction, so
 * there is never a moment with two.
 */
export const createGroup = (input: {
	projectId: string;
	title: string;
	default?: boolean;
	/**
	 * Whether moving a session in here puts its agent to sleep.
	 *
	 * On moves only — a session *opened* into a group is somebody asking for
	 * work to start, and stopping it the moment it was asked for would be the
	 * rule firing in the one case nobody wrote it for.
	 */
	hibernates?: boolean;
}): Promise<Group> =>
	request("/groups", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
