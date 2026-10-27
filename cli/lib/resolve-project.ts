import { resolve } from "node:path";
import { createProject } from "../../client/create-project";
import { listProjects } from "../../client/list-projects";
import type { Project } from "../../daemon/db/schema";
import { expandHome } from "../../daemon/lib/expand-home";
import { normalizePath } from "../../daemon/lib/normalize-path";
import { find } from "./find";

/**
 * Whether what was typed is a place or a name.
 *
 * A separator, a dot or a tilde means a path — nothing else can — and anything
 * without one is read as a project's name or the front of its id. The one thing
 * this gets wrong is a project literally called `x/y`, which is not a folder
 * name any filesystem will give you.
 */
const looksLikePath = (ref: string): boolean =>
	ref.includes("/") || ref === "." || ref === ".." || ref.startsWith("~");

/**
 * The project a command is about.
 *
 * Nothing given means the directory the CLI was run from, and that default is
 * the reason this is worth a file: a person opening a session from a terminal
 * is standing in the repository they mean, and making them name it as well
 * would be asking for something already on the screen. Relative paths resolve
 * here rather than at the daemon — the daemon's own cwd is wherever it was
 * started, and `.` sent over a socket means nothing.
 *
 * `register` is the difference between a read and a write. Opening a session in
 * an unregistered folder registers it, the same way importing one does: a
 * session has to hang under a project to be shown at all, and the folder it
 * runs in is the only honest answer to which one. Listing does not — asking
 * what is in a folder is not a reason to start tracking it, and an unregistered
 * path there is a typo worth being told about.
 */
export async function resolveProject(
	ref: string | undefined,
	{ register }: { register: boolean },
): Promise<Project> {
	if (ref !== undefined && !looksLikePath(ref)) {
		const projects = await listProjects();

		const hit = find(
			projects,
			ref,
			(project) => ({
				id: project.id,
				name: project.name,
				line: `${project.id}  ${project.path}`,
			}),
			"project",
		);

		if (!hit) throw new Error(`no project named ${ref}`);
		return hit;
	}

	const path = normalizePath(resolve(expandHome(ref ?? process.cwd())));
	const known = (await listProjects()).find((project) => project.path === path);

	if (known) return known;

	if (!register) {
		throw new Error(
			`${path} is not a registered project — open a session in it, or add it in the TUI`,
		);
	}

	// The daemon checks the directory is really there and answers with the row,
	// existing or new; `POST /projects` is idempotent for exactly this call.
	return createProject(path);
}
