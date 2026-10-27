import { updateGroup } from "../../client/update-group";
import type { Group } from "../../daemon/db/schema";
import { groupsQuery } from "../queries/groups-query";
import { queryClient } from "../queries/query-client";

/**
 * Folds a group shut, or opens it — and tells the daemon, which is what makes
 * the fold still be there in the other window.
 *
 * Sent as the state it should end in rather than as a toggle. The flip is
 * decided here, off the row this pane is looking at, because two panes that
 * both said "toggle" about a group they both saw open would leave it open, and
 * neither of them asked for that.
 *
 * Painted before the daemon answers. Everything else here waits for the round
 * trip and that is right for a write with a consequence — a rename can fail,
 * a move can be refused — but a fold is a key somebody is holding down while
 * they read, and a heading that turns over one beat later reads as a key that
 * missed. The cache is written first, the socket after, and the only thing that
 * undoes it is the daemon saying no.
 */
export function toggleGroup(group: Group): void {
	const collapsed = !group.collapsed;

	queryClient.setQueryData(groupsQuery.queryKey, (rows: Group[] | undefined) =>
		rows?.map((one) => (one.id === group.id ? { ...one, collapsed } : one)),
	);

	// A refetch already on the wire would answer with the old fold and write it
	// over the line above — the heartbeat asks for this list every beat now, so
	// the window is small and permanent. Cancelling after the paint rather than
	// before it keeps the fold instant.
	queryClient.cancelQueries({ queryKey: groupsQuery.queryKey });

	updateGroup({ id: group.id, collapsed }).catch(() => {
		// Refused, or nothing listening. Put back whatever the daemon really has
		// rather than leaving a fold on screen that nothing recorded — and if
		// that cannot be reached either, the heartbeat will correct it when the
		// socket comes back.
		queryClient.fetchQuery({ ...groupsQuery, staleTime: 0 }).catch(() => {
			/* the status dot already says the daemon is gone */
		});
	});
}
