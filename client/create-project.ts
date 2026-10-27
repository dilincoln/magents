import type { Project } from "../daemon/db/schema";
import { request } from "./request";

/**
 * Registers a repository. The name is not sent: the daemon takes it from the
 * folder, so there is nothing here that can disagree with the path.
 */
export const createProject = (path: string): Promise<Project> =>
	request("/projects", {
		method: "POST",
		body: JSON.stringify({ path }),
	});
