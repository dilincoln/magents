import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { expandHome } from "../../daemon/lib/expand-home";
import { isDirectory } from "./is-directory";

export interface DirEntry {
	/** the folder itself, nothing above it */
	name: string;
	/** absolute, ready to be the next value of the field */
	path: string;
	/** it has a `.git` — usually the thing being looked for */
	repo: boolean;
}

/**
 * The directories a half-typed path could mean.
 *
 * Three cases, and they are the ones a shell completes by:
 *
 * - a trailing slash, or a path that already is a directory → what is inside it
 * - anything else → the siblings under its parent that start with what was typed
 *
 * Directories only. A project is a directory, so a file in the list would be a
 * row that cannot be picked.
 *
 * Unreadable is empty, not an error: `/root` on the way past is a permission
 * denied, and a picker that throws while you type is worse than one that shows
 * you nothing for a moment.
 */
export function listDirectory(input: string): DirEntry[] {
	const expanded = expandHome(input.trim());
	if (expanded === "") return [];

	const listing = expanded.endsWith("/") || isDirectory(expanded);
	const parent = listing ? expanded : dirname(expanded);
	const prefix = listing ? "" : basename(expanded).toLowerCase();

	let names: string[];
	try {
		names = readdirSync(parent);
	} catch {
		return [];
	}

	return (
		names
			.filter((name) => name.toLowerCase().startsWith(prefix))
			// a dot-directory is noise unless it was asked for by name
			.filter((name) => !name.startsWith(".") || prefix.startsWith("."))
			.map((name) => ({ name, path: join(parent, name) }))
			.filter((entry) => isDirectory(entry.path))
			.map((entry) => ({
				...entry,
				repo: existsSync(join(entry.path, ".git")),
			}))
			.sort((a, b) => a.name.localeCompare(b.name))
	);
}
