import { normalizePath } from "./normalize-path";

/** The last segment of a path — what a project is named after. */
export const folderOf = (path: string): string =>
	normalizePath(path).split("/").pop() || path;
