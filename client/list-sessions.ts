import type { LiveSession } from "../daemon/services/terminals";
import { request } from "./request";

/**
 * Every session the daemon knows about, oldest first.
 *
 * `LiveSession` and not the stored row: the daemon overlays its own registry on
 * top before answering, so `pid` is what is running rather than what was last
 * written down, and `state` says "coming up" during a provider's settling
 * window — the two seconds in which a row read off the pid alone would call a
 * session that opened perfectly well dead.
 *
 * A type-only import, so nothing of the daemon's runtime crosses over. It is
 * the same arrangement `Session` itself already had from the schema.
 */
export const listSessions = (projectId?: string): Promise<LiveSession[]> =>
	request(
		projectId
			? `/sessions?project=${encodeURIComponent(projectId)}`
			: "/sessions",
	);
