import type { LiveSession } from "../daemon/services/terminals";
import { request } from "./request";

/**
 * A conversation that already existed, now with a row and a process.
 *
 * `created` is false when the handle was already in the roster. That is a
 * success — the session is there, which is what was asked for — and the form
 * says so rather than pretending to have done something.
 */
export interface ImportedSession {
	session: LiveSession;
	created: boolean;
}

/**
 * Brings in a session started somewhere else, by the provider's own id for it.
 *
 * No provider and no project are sent, because neither is the caller's to know:
 * the daemon asks both providers which of them has the conversation, and the
 * directory it ran in comes off the transcript. A project picked here could
 * only disagree with the one the session actually belongs to.
 *
 * The title is the other way round — nothing on disk knows what you want this
 * called — so it is the one thing the screen has to supply.
 */
export const importSession = (input: {
	externalId: string;
	title: string;
}): Promise<ImportedSession> =>
	request("/sessions/import", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
