import type { Session } from "../daemon/db/schema";
import { request } from "./request";

/** Forgets a session. The provider still has the conversation. */
export const removeSession = (id: string): Promise<Session> =>
	request(`/sessions/${id}`, { method: "DELETE" });
