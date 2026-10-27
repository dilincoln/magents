import type { Session } from "../daemon/db/schema";
import { request } from "./request";

/** Gives a session the name you would rather it had. */
export const renameSession = (input: {
	id: string;
	title: string;
}): Promise<Session> =>
	request(`/sessions/${input.id}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ title: input.title }),
	});
