import type { LiveSession } from "../daemon/services/terminals";
import { request } from "./request";

/**
 * Puts a session in a different bucket, or in none.
 *
 * The same `PATCH /sessions/:id` a rename and an attention mark go through —
 * these are the things about a session anybody is allowed to change, and a
 * second route would only have to be kept in step with the first.
 *
 * The row that comes back may say the agent has stopped. A group can be marked
 * `hibernates`, and moving into one is exactly when that fires, so what returns
 * is the session *after* the rule ran rather than a snapshot from before.
 */
export const moveSession = (input: {
	id: string;
	/** the bucket to put it in, or null to take it out of the one it is in */
	groupId: string | null;
}): Promise<LiveSession> =>
	request(`/sessions/${input.id}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ groupId: input.groupId }),
	});
