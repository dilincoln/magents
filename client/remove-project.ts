import type { Project } from "../daemon/db/schema";
import { request } from "./request";

/** Forgets a project, and every session in it. Nothing on disk is touched. */
export const removeProject = (id: string): Promise<Project> =>
	request(`/projects/${id}`, { method: "DELETE" });
