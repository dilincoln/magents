import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createProject } from "../../client/create-project";
import { projectsQuery } from "./projects-query";

/**
 * Registers a repository, then makes the list say so.
 *
 * Invalidates instead of appending the returned row: registering a known path
 * gives back the row that was already there, and appending it would show it
 * twice. Re-reading is also the only version that stays right when the row came
 * back changed.
 *
 * `onSettled`, not `onSuccess` — a failure is worth a refetch too. If the add
 * failed because the backend went away, that refetch is what turns the status
 * dot amber; without it the dot would sit on a success it read minutes ago.
 */
export function useAddProject() {
	const client = useQueryClient();

	return useMutation({
		mutationFn: createProject,
		onSettled: () =>
			client.invalidateQueries({ queryKey: projectsQuery.queryKey }),
	});
}
