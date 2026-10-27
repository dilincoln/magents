import { queryOptions } from "@tanstack/react-query";
import { listGroups } from "../../client/list-groups";

/**
 * Every group, across projects — one list, like the sessions one.
 *
 * Not keyed by project even though the roster draws them under one. The roster
 * paints every project at once, so a query per project would be a request per
 * folder on the screen to assemble a list the daemon can produce in a single
 * statement.
 */
export const groupsQuery = queryOptions({
	queryKey: ["groups"],
	queryFn: () => listGroups(),
});
