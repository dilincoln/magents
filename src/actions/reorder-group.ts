import { updateGroup } from "../../client/update-group";
import { flatten } from "../lib/roster";
import { groupsQuery } from "../queries/groups-query";
import { queryClient } from "../queries/query-client";
import {
	selectedRow,
	useAppStore,
	visibleSections,
} from "../store/use-app-store";

/**
 * Moves the selected group one place up or down its project.
 *
 * The daemon is told a neighbour rather than a slot — "put it after that one",
 * or first when there is nothing to be after — so this works out which group
 * should end up in front of it: the one before the slot when going up, the
 * occupant of the slot when going down.
 *
 * Off the roster's own sections rather than the raw group list, so a search
 * that has narrowed the tree narrows this too. The anchor is then a bucket the
 * person can see, and pressing the key twice moves past two rows they are
 * looking at — where reading the unfiltered list would have made the second
 * press appear to do nothing while the group hopped over something hidden.
 *
 * Nothing at the ends. A group at the top asked to go up has nowhere to go,
 * and wrapping it to the bottom would be a different request answered with the
 * same key.
 */
export function reorderGroup(delta: -1 | 1): void {
	const row = selectedRow();
	if (row?.kind !== "group") return;

	const siblings =
		visibleSections()
			.find((section) => section.project?.id === row.project.id)
			?.buckets.map((bucket) => bucket.group) ?? [];

	const at = siblings.findIndex((group) => group.id === row.group.id);
	const to = at + delta;
	if (at === -1 || to < 0 || to >= siblings.length) return;

	const anchor = delta < 0 ? siblings[to - 1] : siblings[to];

	updateGroup({ id: row.group.id, after: anchor?.id ?? null })
		/*
		 * Fetched rather than invalidated, which is what every other write here
		 * does, because this one has to know when the new list has arrived: the
		 * cursor is moved on the next line. An invalidation resolves as soon as it
		 * has marked the data stale unless somebody is observing the query, so
		 * following it with `.then` would make the cursor land correctly only
		 * while the roster happens to be mounted and rendering this list —
		 * measured, and not a thing to hang a cursor on.
		 *
		 * `staleTime: 0` for this call alone. The client's default is never-stale
		 * on purpose — nothing here is a feed — and this is the mutation saying
		 * out loud that the list it is holding is the old one.
		 */
		.then(() => queryClient.fetchQuery({ ...groupsQuery, staleTime: 0 }))
		.then(() => follow(row.group.id))
		.catch(() => {
			/* daemon down; the status dot already says so */
		});
}

/**
 * Puts the cursor back on the group, wherever it ended up.
 *
 * The cursor is an index into the painted rows, and the whole point of this
 * key is that those rows just moved — so holding the index would leave the
 * selection on whichever group took the old slot, and a second press would
 * move a different bucket. Run once the refetched list is in the cache, so the
 * rows counted here are the rows about to be painted.
 */
const follow = (id: string): void => {
	const { query } = useAppStore.getState();
	const rows = flatten(visibleSections(), query);

	const at = rows.findIndex(
		(row) => row.kind === "group" && row.group.id === id,
	);
	if (at !== -1) useAppStore.getState().setCursor(at);
};
