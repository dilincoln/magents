import { parseArgs } from "node:util";
import { listProjects } from "../../client/list-projects";
import type { Command } from "../command";
import { table } from "../lib/columns";

/**
 * Every registered project, oldest first — the daemon's order, kept.
 *
 * Full ids rather than the short form the session list uses. A project id is
 * the thing that goes into `--project` and into a script, it is one per
 * repository so the column is short anyway, and there is nothing to gain by
 * making it something to expand later.
 */
export const projectsCommand: Command = {
	summary: "list the registered projects",
	usage: `magents projects — list the registered projects

usage
  magents projects [--json]

flags
      --json    the daemon's own JSON, for a script to read`,

	async run(argv) {
		const { values } = parseArgs({
			args: argv,
			options: { json: { type: "boolean" } },
			strict: true,
		});

		const projects = await listProjects();

		if (values.json) {
			console.log(JSON.stringify(projects, null, 2));
			return;
		}

		if (projects.length === 0) {
			console.log("no projects yet");
			return;
		}

		console.log(
			table([
				["ID", "NAME", "PATH"],
				...projects.map((project) => [project.id, project.name, project.path]),
			]),
		);
	},
};
