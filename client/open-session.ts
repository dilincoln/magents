import type { ProviderId } from "../daemon/providers/provider-id";
import type { LiveSession } from "../daemon/services/terminals";
import { request } from "./request";

/**
 * A session that exists, and whose process the daemon has been asked for.
 *
 * It used to carry the argv beside the row, because the terminal lived over
 * here and had to be told what to execute. The daemon starts the process now,
 * so a command on the wire would be an invitation to open a second agent on the
 * same conversation.
 *
 * Asked for, not necessarily running: `state` comes back `starting` while a
 * provider settles, which for codex is two seconds after this answers.
 */
export interface OpenedSession {
	session: LiveSession;
}

/**
 * Opens one. The daemon runs it, and there is nothing to say about that.
 *
 * There was briefly a `start` flag here, so a client running its own terminals
 * could ask for the row without the process. It went with the path that needed
 * it: skipping the spawn is right for codex, whose conversation already exists
 * by the time this is called, and silently wrong for claude, where the skipped
 * command is the only one that ever *creates* the conversation — so the prompt
 * went nowhere and the pane resumed something that had never happened.
 */
export const openSession = (input: {
	projectId: string;
	provider: ProviderId;
	prompt: string;
	model: string | null;
	variant: string | null;
	/**
	 * A name for it. Left out — which is what the spawn panel does — the daemon
	 * takes one from the prompt's first line.
	 */
	title?: string | null;
	/**
	 * Which bucket to open it in.
	 *
	 * Three answers. Left out is "you decide", and the daemon puts it in the
	 * project's default group if there is one. A string is a group somebody
	 * chose. An explicit `null` is *none*, on purpose — which has to be
	 * distinguishable from not asking, or a project with a default could never
	 * be opted out of.
	 */
	groupId?: string | null;
}): Promise<OpenedSession> =>
	request("/sessions", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
