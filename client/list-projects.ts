import type { Project } from "../daemon/db/schema";
import { request } from "./request";

/** Every project the daemon knows about, oldest first. */
export const listProjects = (): Promise<Project[]> => request("/projects");
