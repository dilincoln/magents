import { statSync } from "node:fs";
import { expandHome } from "../../daemon/lib/expand-home";

/** Whether a path, as typed, is a directory that is there. False for anything unreadable. */
export function isDirectory(path: string): boolean {
	try {
		return statSync(expandHome(path.trim())).isDirectory();
	} catch {
		return false;
	}
}
