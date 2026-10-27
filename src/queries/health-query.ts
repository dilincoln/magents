import { queryOptions } from "@tanstack/react-query";
import { checkHealth } from "../../client/check-health";

/**
 * Is the daemon there.
 *
 * Its own query rather than a fact inferred from whichever data query ran last.
 * Inferring is what left the dot green over a daemon that had died: nothing had
 * asked it anything since, so nothing had found out. This is asked on a timer —
 * see `useDaemonHeartbeat` — and it is the only query that is.
 */
export const healthQuery = queryOptions({
	queryKey: ["health"],
	queryFn: checkHealth,
});
