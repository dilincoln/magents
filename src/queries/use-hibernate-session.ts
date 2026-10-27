import { useMutation, useQueryClient } from "@tanstack/react-query";
import { stopTerminal } from "../../client/stop-terminal";
import { sessionsQuery } from "./sessions-query";

/**
 * Ends a session's agent and leaves everything else standing.
 *
 * The screen is deliberately not let go of, which is the whole difference from
 * removing one: `detachTerminal` is what a removal calls, and calling it here
 * would throw away the emulator holding the last thing the agent printed —
 * the thing somebody hibernating a finished session comes back to read.
 *
 * `onSettled` for the same reason the removal has it: a call that failed
 * because the daemon went away should leave the list refetching rather than
 * showing rows read back when things were working.
 *
 * The pane needs nothing from this. The daemon pushes a `session` frame down
 * the attach socket when the process ends, so the strip and the footer have
 * already changed their minds by the time the list comes back — this
 * invalidation is for the roster's mark, which reads the pid off the row.
 */
export function useHibernateSession() {
	const client = useQueryClient();

	return useMutation({
		mutationFn: stopTerminal,
		onSettled: () =>
			client.invalidateQueries({ queryKey: sessionsQuery.queryKey }),
	});
}
