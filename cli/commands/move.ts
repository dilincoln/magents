import { parseArgs } from "node:util";
import { moveSession } from "../../client/move-session";
import { type Command, UsageError } from "../command";
import { short, table } from "../lib/columns";
import { resolveGroup } from "../lib/resolve-group";
import { resolveProject } from "../lib/resolve-project";
import { resolveSession } from "../lib/resolve-session";

/**
 * Puts a session in a different bucket.
 *
 * The group is looked up in the *session's own* project rather than in the
 * directory you happen to be standing in, and that is worth stating because it
 * is the one place `--project` would have been the obvious flag and is wrong.
 * A session belongs to a project; groups belong to projects; so the pair is
 * already determined the moment the session is named, and offering a project
 * flag would let somebody ask for a move into a bucket in another repository,
 * which the daemon would take and the roster could never draw.
 *
 * If the target group is marked as hibernating, this stops the agent — and says
 * so, because a command that silently kills a process is a command nobody
 * should trust twice.
 */
export const moveCommand: Command = {
	summary: "put a session in a different group",
	usage: `magents move — put a session in a different group

usage
  magents move <session> <group>
  magents move <session> --none

flags
${table([
	["      --none", "take it out of whatever group it is in"],
	["      --json", "the moved row as the daemon's own JSON"],
])}

notes
  the group is looked up in the session's own project, so there is no
  \`--project\` here: naming the session has already settled which one.

  a group marked as hibernating stops the agent when a session lands in it.
  \`magents groups\` marks those, and this says when it happened.`,

	async run(argv) {
		const { values, positionals } = parseArgs({
			args: argv,
			options: { none: { type: "boolean" }, json: { type: "boolean" } },
			allowPositionals: true,
			strict: true,
		});

		const named = positionals[0];
		if (!named) throw new UsageError("which session? give an id or its name");

		const target = positionals[1];

		if (!target && !values.none) {
			throw new UsageError("which group? give a name, or pass --none");
		}

		if (target && values.none) {
			throw new UsageError("--none and a group ask for opposite things");
		}

		const session = await resolveSession(named);

		// By id, and registering nothing: the project exists because the session
		// is in it. `resolveProject` takes a ref of any shape and an id is one.
		const project = await resolveProject(session.projectId, {
			register: false,
		});

		const group = target
			? await resolveGroup(target, project.id, project.name)
			: null;

		const moved = await moveSession({
			id: session.id,
			groupId: group?.id ?? null,
		});

		if (values.json) {
			console.log(JSON.stringify(moved, null, 2));
			return;
		}

		console.log(`${short(moved.id)}  ${moved.title}`);
		console.log(`  ${project.name} · ${group ? group.title : "no group"}`);

		// Said out loud rather than left to be discovered in the roster. The rule
		// belongs to the group, so from here it looks like the move did it.
		if (group?.hibernates) {
			console.log(`  ${group.title} hibernates — its agent was stopped`);
		}
	},
};
