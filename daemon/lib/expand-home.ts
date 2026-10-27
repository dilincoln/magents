import { homedir } from "node:os";

/**
 * `~` is shell syntax, not a path. It reaches the daemon unexpanded whenever a
 * caller passes through what a user typed, and `statSync("~/code")` fails on a
 * directory that is plainly there.
 */
export const expandHome = (path: string): string =>
	path === "~" || path.startsWith("~/") ? homedir() + path.slice(1) : path;
