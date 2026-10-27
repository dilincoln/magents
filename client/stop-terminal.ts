import type { TerminalState } from "../daemon/lib/attach-frames";
import { request } from "./request";

/**
 * Asks the daemon to end this session's process and keep the session.
 *
 * `DELETE /sessions/:id/terminal` — the exact inverse of `startTerminal`, and
 * the two routes are a pair on purpose: one puts a process on a row, the other
 * takes it off, and neither touches the row or the screen the process left
 * behind. Removing the session itself is `DELETE /sessions/:id`, which kills
 * this way first and then deletes.
 *
 * Not a session row on the way back but what the registry knows a moment after
 * the kill, which is the honest answer to what was asked: the process is what
 * changed, so the process is what is reported.
 *
 * Awaited by its callers, unlike a start. The daemon gives the child up to two
 * seconds of grace before insisting, and it waits that out before answering —
 * so this resolves when the agent is genuinely gone rather than when it has
 * been asked to go.
 */
export const stopTerminal = (
	id: string,
): Promise<{ pid: number | null; state: TerminalState }> =>
	request(`/sessions/${id}/terminal`, { method: "DELETE" });
