import { useMutation, useQueryClient } from "@tanstack/react-query";
import { removeProject } from "../../client/remove-project";
import { projectsQuery } from "./projects-query";

/**
 * Removes a project, then makes the list say so.
 *
 * `onSettled` for the same reason the add has it: a failure is worth a refetch
 * too. A removal that failed because the backend went away should turn the
 * status dot amber rather than leave it on a success read minutes ago.
 */
export function useRemoveProject() {
	const client = useQueryClient();

	return useMutation({
		mutationFn: removeProject,
		onSettled: () =>
			client.invalidateQueries({ queryKey: projectsQuery.queryKey }),
	});
}
