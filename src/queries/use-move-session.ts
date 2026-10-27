import { useMutation, useQueryClient } from "@tanstack/react-query";
import { moveSession } from "../../client/move-session";
import { sessionsQuery } from "./sessions-query";

/**
 * Puts a session in a different bucket.
 *
 * Invalidated rather than patched in place, like every other write here, and
 * with one extra reason: a group marked `hibernates` stops the agent as part of
 * the move, so the row that matters afterwards has a different `state` and no
 * pid. A client splicing in its own guess would draw the session as running
 * until the next heartbeat corrected it.
 */
export function useMoveSession() {
	const client = useQueryClient();

	return useMutation({
		mutationFn: moveSession,
		onSuccess: () =>
			client.invalidateQueries({ queryKey: sessionsQuery.queryKey }),
	});
}
