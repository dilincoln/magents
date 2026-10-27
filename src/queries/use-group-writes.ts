import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createGroup } from "../../client/create-group";
import { removeGroup } from "../../client/remove-group";
import { updateGroup } from "../../client/update-group";
import { groupsQuery } from "./groups-query";
import { sessionsQuery } from "./sessions-query";

/**
 * The three writes a group has, in one file because they invalidate the same
 * pair of lists and the pairing is the part worth keeping together.
 *
 * Sessions as well as groups, and that is not belt and braces. Making a group
 * the default changes nothing about any session, but *removing* one sets
 * `group_id` to null on every session that was in it — so a client that
 * refetched only the groups would keep drawing those sessions under a heading
 * that no longer exists, until the heartbeat happened to catch up.
 */
const invalidate = (client: ReturnType<typeof useQueryClient>) =>
	Promise.all([
		client.invalidateQueries({ queryKey: groupsQuery.queryKey }),
		client.invalidateQueries({ queryKey: sessionsQuery.queryKey }),
	]);

export function useCreateGroup() {
	const client = useQueryClient();
	return useMutation({
		mutationFn: createGroup,
		onSuccess: () => invalidate(client),
	});
}

export function useUpdateGroup() {
	const client = useQueryClient();
	return useMutation({
		mutationFn: updateGroup,
		onSuccess: () => invalidate(client),
	});
}

export function useRemoveGroup() {
	const client = useQueryClient();
	return useMutation({
		mutationFn: removeGroup,
		onSuccess: () => invalidate(client),
	});
}
