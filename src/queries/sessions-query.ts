import { queryOptions } from "@tanstack/react-query";
import { listSessions } from "../../client/list-sessions";

/**
 * Every open session, across projects.
 *
 * Not keyed by project even though the roster shows them grouped: the roster
 * paints every project at once, so one list fetched once beats a query per
 * group, and grouping is a thing the screen already does to agents.
 */
export const sessionsQuery = queryOptions({
	queryKey: ["sessions"],
	queryFn: () => listSessions(),
});
