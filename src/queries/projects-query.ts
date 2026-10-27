import { queryOptions } from "@tanstack/react-query";
import { listProjects } from "../../client/list-projects";

/**
 * The registered projects.
 *
 * Declared once and shared, so the key cannot drift between the component that
 * reads it, the mutation that invalidates it, and the key handler that counts
 * it — a query key written out twice is two queries that look like one.
 */
export const projectsQuery = queryOptions({
	queryKey: ["projects"],
	queryFn: listProjects,
});
