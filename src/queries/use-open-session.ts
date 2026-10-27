import { useMutation, useQueryClient } from "@tanstack/react-query";
import { openSession } from "../../client/open-session";
import { sessionsQuery } from "./sessions-query";

/**
 * Opens a session and puts it in the roster.
 *
 * The list is invalidated rather than written into: the daemon decides what a
 * session row looks like, and a client that patched its own guess in would show
 * a slightly different row until the next refetch corrected it.
 */
export function useOpenSession() {
	const client = useQueryClient();

	return useMutation({
		mutationFn: openSession,
		onSuccess: () =>
			client.invalidateQueries({ queryKey: sessionsQuery.queryKey }),
	});
}
