import { useMutation, useQueryClient } from "@tanstack/react-query";
import { renameSession } from "../../client/rename-session";
import { sessionsQuery } from "./sessions-query";

/**
 * Renames a session, then makes the roster say so.
 *
 * Invalidated rather than patched in place, like every other write here: the
 * daemon decides what a session row looks like, and the row it answers with has
 * the live process on it — a client that spliced its own version in would drop
 * that and paint a running agent as stopped until the next heartbeat.
 */
export function useRenameSession() {
	const client = useQueryClient();

	return useMutation({
		mutationFn: renameSession,
		onSuccess: () =>
			client.invalidateQueries({ queryKey: sessionsQuery.queryKey }),
	});
}
