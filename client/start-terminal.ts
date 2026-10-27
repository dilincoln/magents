import type { Session } from "../daemon/db/schema";
import { request } from "./request";

/**
 * Asks the daemon to put a process back on a session.
 *
 * A terminal is asked for, not a command: the adapter that knows how to resume
 * a provider lives on the daemon's side of the socket now, so nothing here has
 * an argv to send and nothing here could run one if it did. The answer is the
 * session row with the new pid on it.
 */
export const startTerminal = (id: string): Promise<Session> =>
	request(`/sessions/${id}/terminal`, { method: "POST" });
