import { parseArgs } from "node:util";
import { listProjects } from "../../client/list-projects";
import { listSessions } from "../../client/list-sessions";
import type { Command } from "../command";
import { short, table } from "../lib/columns";
import { resolveProject } from "../lib/resolve-project";

/**
 * The open sessions, with where each one's process is.
 *
 * `state` and not the stored pid column, because the daemon lays its registry
 * over the rows before answering: a session inside a provider's settling window
 * has no pid to name and is coming up rather than dead, and the pid on the row
 * is a projection written a moment after the fact. The same overlay the roster
 * reads — one answer to "is it running", not two.
 *
 * `--project` is a filter and never a registration: asking what is open in a
 * folder is not a reason to start tracking it. Left out, this lists everything
 * rather than the current directory, because a control plane's first question
 * is what is running anywhere.
 */
export const sessionsCommand: Command = {
	summary: "list open sessions",
	usage: `magents sessions — list open sessions

usage
  magents sessions [--project <ref>] [--json]

flags
      --project <ref>   only this project — a path, a name, or an id
      --json            the daemon's own JSON, for a script to read`,

	async run(argv) {
		const { values } = parseArgs({
			args: argv,
			options: {
				project: { type: "string" },
				json: { type: "boolean" },
			},
			strict: true,
		});

		const project = values.project
			? await resolveProject(values.project, { register: false })
			: null;

		const sessions = await listSessions(project?.id);

		if (values.json) {
			console.log(JSON.stringify(sessions, null, 2));
			return;
		}

		if (sessions.length === 0) {
			console.log(project ? `nothing open in ${project.name}` : "no sessions");
			return;
		}

		// Only when the column is going to be printed. Filtered to one project the
		// name is already known and repeating it down every row says nothing.
		const named = project
			? new Map([[project.id, project.name]])
			: new Map(
					(await listProjects()).map((row) => [row.id, row.name] as const),
				);

		console.log(
			table([
				["ID", "PROVIDER", "STATE", "PID", "PROJECT", "TITLE"],
				...sessions.map((session) => [
					short(session.id),
					session.provider,
					session.state,
					session.pid === null ? "-" : String(session.pid),
					named.get(session.projectId) ?? "-",
					session.title,
				]),
			]),
		);
	},
};
