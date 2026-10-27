import { useEffect } from "react";
import { DaemonUnreachable } from "../../client/daemon-unreachable-error";
import { groupsQuery } from "../queries/groups-query";
import { healthQuery } from "../queries/health-query";
import { projectsQuery } from "../queries/projects-query";
import { queryClient } from "../queries/query-client";
import { sessionsQuery } from "../queries/sessions-query";

/** How often to ask whether the daemon is still there. */
const BEAT_MS = 1_500;

/**
 * The one thing on this screen that runs on a clock.
 *
 * It answers both halves of the same problem, which are the same bug seen from
 * two sides. Nothing here goes stale on its own, so a screen that started
 * before the daemon never noticed it arrive — and a screen whose daemon died
 * kept showing a green dot, because nothing had asked since the last time it
 * worked. Neither is a retry: one is a question nobody was repeating.
 *
 * Five calls now, deliberately different in reach.
 *
 * `health` is asked every beat, always. It is a socket round trip and no more —
 * no database, no providers — so asking it forever costs nothing.
 *
 * `sessions` is asked every beat too, and that is a change of doctrine worth
 * naming: health used to be the only query allowed to be a feed, on the grounds
 * that everything else changes only when this process changes it. That stopped
 * being true when the agents moved. Which sessions are running is now a fact
 * about processes in another program, minted and ended without anybody here
 * asking, and the roster's mark reads it off the row — so it goes stale on its
 * own exactly the way the status dot did. The cost is up to a beat and a half
 * of latency on a session nobody is attached to; the pane on screen gets the
 * fast half pushed to it over its own socket.
 *
 * `projects` joined them when the CLI landed, and it is the same doctrine
 * failing the same way a second time. The rule was "the data changes when this
 * process changes it"; the agents moving made that untrue of sessions, and
 * `cli/` makes it untrue of projects — `magents new` in an unregistered folder
 * registers one, from another terminal, with nothing here asking. It is not a
 * cosmetic gap either: the roster draws sessions *under* their project and only
 * iterates the projects it knows, so a session whose project arrived after the
 * last fetch is not a row that looks stale, it is a row that is not drawn.
 *
 * `groups` is the third time the same rule failed, and the most direct: the
 * fold is stored now, so the whole point of storing it is that the other window
 * finds out. `magents groups add` from a terminal lands the same way, and a
 * bucket that exists but is not drawn takes its sessions off the screen with
 * it — the roster only paints a session under a heading it knows about.
 *
 * Everything else is asked again only when it could not reach the socket at
 * all. A daemon that answered and refused has given an answer, and repeating
 * the question would not change it; a daemon that was missing has data we are
 * still owed. That is why the predicate is the error type and not a flag.
 *
 * `refetchInterval` would be the obvious home for this and does not work here:
 * with an observer subscribed and a 500ms interval, two seconds produce exactly
 * one fetch, whether the query succeeds or fails.
 */
export function useDaemonHeartbeat(): void {
	useEffect(() => {
		const beat = setInterval(() => {
			queryClient.refetchQueries({ queryKey: healthQuery.queryKey });
			queryClient.refetchQueries({ queryKey: sessionsQuery.queryKey });
			queryClient.refetchQueries({ queryKey: projectsQuery.queryKey });
			queryClient.refetchQueries({ queryKey: groupsQuery.queryKey });
			queryClient.refetchQueries({
				predicate: (query) => query.state.error instanceof DaemonUnreachable,
			});
		}, BEAT_MS);

		return () => clearInterval(beat);
	}, []);
}
