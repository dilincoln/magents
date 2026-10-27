import type { Session } from "../daemon/db/schema";
import { request } from "./request";

/**
 * Lights a session's row, or puts it out.
 *
 * The same `PATCH /sessions/:id` a rename goes through, because they are the
 * two things about a session anybody is allowed to change and a second route
 * would only have to be kept in step with the first.
 */
export const setAttention = (input: {
	id: string;
	requiresAttention: boolean;
}): Promise<Session> =>
	request(`/sessions/${input.id}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ requiresAttention: input.requiresAttention }),
	});
