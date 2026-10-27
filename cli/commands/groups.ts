import { parseArgs } from "node:util";
import { createGroup } from "../../client/create-group";
import { listGroups } from "../../client/list-groups";
import { removeGroup } from "../../client/remove-group";
import { updateGroup } from "../../client/update-group";
import { type Command, UsageError } from "../command";
import { short, table } from "../lib/columns";
import { resolveGroup } from "../lib/resolve-group";
import { resolveProject } from "../lib/resolve-project";

/**
 * The buckets sessions are opened into.
 *
 * Sub-verbs rather than four top-level commands, which is the one place this
 * departs from the flat shape of the rest. `projects` and `sessions` are lists
 * and nothing else; a group is a thing you make, rename, retire and point new
 * work at, and four more entries at the top level would bury `new` — the
 * command anybody actually types — in administration.
 *
 * Every verb is scoped to a project, defaulting to the directory you are
 * standing in, because a group's name is only unique inside one. `Active` in
 * two repositories is two buckets, which is the point of them.
 */
export const groupsCommand: Command = {
	summary: "list and manage a project's session groups",
	usage: `magents groups — the buckets sessions are opened into

usage
  magents groups [--project <ref>] [--json]
  magents groups add <title> [--project <ref>] [--default] [--hibernates]
  magents groups rename <group> <title> [--project <ref>]
  magents groups default <group> [--project <ref>]
  magents groups hibernate <group> [--off] [--project <ref>]
  magents groups move <group> (--after <group> | --first) [--project <ref>]
  magents groups rm <group> [--project <ref>]

flags
${table([
	["      --project <ref>", "a path, a name, or an id — the cwd by default"],
	["      --default", "on `add`: open new sessions here from now on"],
	["      --hibernates", "on `add`: stop the agent when a session moves in"],
	["      --off", "on `hibernate`: stop doing that"],
	["      --after <group>", "on `move`: put it just below that one"],
	["      --first", "on `move`: put it at the top of the project"],
	["      --json", "the daemon's own JSON, for a script to read"],
])}

notes
  a project's default group is where \`magents new\` puts a session when no
  \`--group\` is given. a project may have none, and then sessions hang
  directly off it — which is what every session did before groups existed.

  removing a group does not remove its sessions. they go back to hanging off
  the project, the same as if the group had never been made.

  \`default\` only ever sets. to stop a group being the default, make another
  one it — a project with no home for new sessions is a different request.
  \`hibernate\` goes both ways, because "stop putting things to sleep here"
  means exactly one thing.

  a hibernating group stops the agent when a session is *moved* in, never when
  one is opened there: opening a session is asking for work to start.

  \`move\` names a neighbour rather than a number: --after Active is "put it
  just below Active", which stays true however the rest of the list is
  arranged. new groups are made at the bottom, which is the only place a
  bucket nobody has placed yet honestly belongs.`,

	async run(argv) {
		const { values, positionals } = parseArgs({
			args: argv,
			options: {
				project: { type: "string" },
				default: { type: "boolean" },
				hibernates: { type: "boolean" },
				off: { type: "boolean" },
				after: { type: "string" },
				first: { type: "boolean" },
				json: { type: "boolean" },
			},
			allowPositionals: true,
			strict: true,
		});

		const [verb, ...rest] = positionals;

		// Listing does not register a folder, creating does — the same split
		// `resolveProject` makes everywhere: asking what is in a directory is not
		// a reason to start tracking it.
		const project = await resolveProject(values.project, {
			register: verb === "add",
		});

		const group = async (ref: string | undefined) => {
			if (!ref) throw new UsageError("which group? give a name or an id");
			return resolveGroup(ref, project.id, project.name);
		};

		const show = (row: {
			id: string;
			title: string;
			isDefault: boolean;
			hibernates: boolean;
			collapsed: boolean;
		}) => {
			if (values.json) {
				console.log(JSON.stringify(row, null, 2));
				return;
			}
			// `folded` is a fact about a screen and it is listed here anyway: it is
			// stored, it is shared, and somebody wondering why a bucket looks empty
			// in their roster should be able to find out from the terminal they are
			// already in.
			const marks = [
				row.isDefault ? "default" : null,
				row.hibernates ? "hibernates" : null,
				row.collapsed ? "folded" : null,
			].filter(Boolean);
			console.log(
				`${short(row.id)}  ${row.title}${marks.length ? `  (${marks.join(", ")})` : ""}`,
			);
		};

		if (verb === undefined) {
			const groups = await listGroups(project.id);

			if (values.json) {
				console.log(JSON.stringify(groups, null, 2));
				return;
			}

			if (groups.length === 0) {
				console.log(`${project.name} has no groups`);
				return;
			}

			console.log(
				table([
					["ID", "TITLE", ""],
					...groups.map((one) => [
						short(one.id),
						one.title,
						[
							one.isDefault ? "default" : null,
							one.hibernates ? "hibernates" : null,
							one.collapsed ? "folded" : null,
						]
							.filter(Boolean)
							.join(", "),
					]),
				]),
			);
			return;
		}

		if (verb === "add") {
			const title = rest[0];
			if (!title) throw new UsageError("what should it be called?");

			show(
				await createGroup({
					projectId: project.id,
					title,
					default: values.default === true,
					hibernates: values.hibernates === true,
				}),
			);
			return;
		}

		if (verb === "rename") {
			const title = rest[1];
			if (!title) throw new UsageError("what should it be called now?");

			show(await updateGroup({ id: (await group(rest[0])).id, title }));
			return;
		}

		if (verb === "default") {
			show(await updateGroup({ id: (await group(rest[0])).id, default: true }));
			return;
		}

		if (verb === "hibernate") {
			show(
				await updateGroup({
					id: (await group(rest[0])).id,
					hibernates: values.off !== true,
				}),
			);
			return;
		}

		if (verb === "move") {
			if (values.after && values.first) {
				throw new UsageError("--after and --first ask for opposite things");
			}

			if (!values.after && !values.first) {
				throw new UsageError(
					"where to? --after <group>, or --first for the top",
				);
			}

			// Both groups resolved before either is used, so naming one that does
			// not exist is refused rather than half-applied.
			const moving = await group(rest[0]);
			const anchor = values.after ? await group(values.after) : null;

			if (anchor?.id === moving.id) {
				throw new UsageError(`${moving.title} cannot go after itself`);
			}

			show(await updateGroup({ id: moving.id, after: anchor?.id ?? null }));
			return;
		}

		if (verb === "rm") {
			const removed = await removeGroup((await group(rest[0])).id);

			if (values.json) {
				console.log(JSON.stringify(removed, null, 2));
				return;
			}

			// Said out loud because the obvious fear is the wrong one: `rm` next to
			// a list of sessions reads as though it takes them too.
			console.log(`${short(removed.id)}  ${removed.title} — removed`);
			console.log("  its sessions are still there, now under the project");
			return;
		}

		throw new UsageError(
			`no such thing as \`groups ${verb}\` — try add, rename, default, hibernate, move or rm`,
		);
	},
};
