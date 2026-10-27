import { useMutation, useQueryClient } from "@tanstack/react-query";
import { removeSession } from "../../client/remove-session";
import { detachTerminal } from "../lib/session-terminals";
import { sessionsQuery } from "./sessions-query";

/**
 * Removes a session, then makes the roster say so.
 *
 * `onSettled`, not `onSuccess`: a removal that failed because the daemon went
 * away should leave the list refetching and the status dot honest, rather than
 * showing rows read back when things were working.
 *
 * The kill has left this file, and `detachTerminal` now only lets go of the
 * screen. The argument for killing here — on success only, so a failed delete
 * never left a dead agent under a row that was still standing — was correct for
 * two processes and is wrong for one. The daemon kills the child *before* it
 * deletes the row, in the same operation, which closes the hazard the other way
 * round: delete first, crash in the window, and there is a running agent with
 * no row and no pid, unreachable by any boot sweep, forever.
 */
export function useRemoveSession() {
	const client = useQueryClient();

	return useMutation({
		mutationFn: removeSession,
		onSuccess: (_result, id) => detachTerminal(id),
		onSettled: () =>
			client.invalidateQueries({ queryKey: sessionsQuery.queryKey }),
	});
}
