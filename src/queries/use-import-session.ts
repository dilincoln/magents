import { useMutation, useQueryClient } from "@tanstack/react-query";
import { importSession } from "../../client/import-session";
import { projectsQuery } from "./projects-query";
import { sessionsQuery } from "./sessions-query";

/**
 * Imports a session and puts it in the roster.
 *
 * Two lists invalidated, not one. An import registers the folder the session
 * ran in if it was not registered already, so it can add a project as well as a
 * session — and a session whose project is missing from the list has nothing to
 * be grouped under, which shows up as a row that simply is not drawn.
 */
export function useImportSession() {
	const client = useQueryClient();

	return useMutation({
		mutationFn: importSession,
		onSuccess: () => {
			client.invalidateQueries({ queryKey: projectsQuery.queryKey });
			client.invalidateQueries({ queryKey: sessionsQuery.queryKey });
		},
	});
}
