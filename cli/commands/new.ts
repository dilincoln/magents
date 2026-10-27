import { parseArgs } from "node:util";
import { listGroups } from "../../client/list-groups";
import { openSession } from "../../client/open-session";
import { isProviderId, providerIds } from "../../daemon/providers/provider-id";
import { type Command, UsageError } from "../command";
import { short, table } from "../lib/columns";
import { resolveGroup } from "../lib/resolve-group";
import { resolveProject } from "../lib/resolve-project";

/**
 * Opens a session, in a project, on a provider.
 *
 * The provider is required and nothing is assumed, which is the one place this
 * deliberately differs from the spawn panel. The panel opens on codex and says
 * so on the screen, next to a key that changes it — the default is visible and
 * revisable before anything is sent. Here there is no screen: a default would
 * be an invisible choice made on somebody's behalf, and finding out about it
 * means finding an agent you did not mean to start already running.
 *
 * The model is not checked against the provider's list. Doing so would mean a
 * round trip that starts the provider's CLI just to find out — `magents models`
 * is there for when that is the actual question — and the provider is the
 * authority on its own names anyway, so a typo comes back in its own words
 * rather than in a guess of ours.
 *
 * By the time this prints, the process is running on the other side of the
 * socket. There is nothing to attach to from here: the terminal belongs to the
 * daemon, and the TUI is where you go to watch it.
 */
export const newCommand: Command = {
	summary: "open a session on a provider",
	usage: `magents new — open a session on a provider

usage
  magents new -p <provider> --prompt <text> [flags]

flags
${table([
	[
		`  -p, --provider <${providerIds.join("|")}>`,
		"required — nothing is assumed",
	],
	["      --prompt <text>", "what to ask; `-` reads it from stdin"],
	["  -m, --model <id>", "the provider's own default when left out"],
	["      --variant <id>", "how hard it thinks, where the model has variants"],
	[
		"  -n, --name <text>",
		"what to call it; the prompt's first line if left out",
	],
	["      --project <ref>", "a path, a name, or an id — the cwd by default"],
	["  -g, --group <ref>", "which bucket; the project's default if left out"],
	["      --no-group", "none, even where the project has a default"],
	["      --json", "the new row as the daemon's own JSON"],
])}

notes
  the folder is registered as a project if it is not one already, the same way
  importing a session does: a session has to hang under one to be shown at all.

  \`--prompt -\` is how a long one gets in:
    magents new -p claude -n "port the parser" --prompt - < brief.md

  a group is named the way everything else here is — its title, or the front
  of its id — and looked up inside the project, since two projects may each
  have one called \`Active\`. \`magents groups\` lists them.`,

	async run(argv) {
		const { values } = parseArgs({
			args: argv,
			options: {
				provider: { type: "string", short: "p" },
				model: { type: "string", short: "m" },
				variant: { type: "string" },
				prompt: { type: "string" },
				name: { type: "string", short: "n" },
				project: { type: "string" },
				group: { type: "string", short: "g" },
				"no-group": { type: "boolean" },
				json: { type: "boolean" },
			},
			strict: true,
		});

		const provider = values.provider;

		if (!provider) {
			throw new UsageError(`which provider? -p ${providerIds.join(" or -p ")}`);
		}

		if (!isProviderId(provider)) {
			throw new UsageError(
				`${provider} is not a provider — expected ${providerIds.join(" or ")}`,
			);
		}

		// Read before anything else is asked of the daemon, so a pipe that turns
		// out to be empty is a usage error rather than a project registered for a
		// session that is then refused.
		const prompt =
			values.prompt === "-" ? await Bun.stdin.text() : (values.prompt ?? "");

		if (!prompt.trim()) {
			throw new UsageError(
				values.prompt === "-"
					? "nothing arrived on stdin"
					: "what should it do? pass --prompt",
			);
		}

		if (values.group && values["no-group"]) {
			throw new UsageError("--group and --no-group ask for opposite things");
		}

		const project = await resolveProject(values.project, { register: true });

		/*
		 * Three answers, and the field is left off entirely for the middle one.
		 *
		 * Absent means "you decide", which the daemon reads as the project's
		 * default group. `--no-group` has to be able to beat that default, so it
		 * sends an explicit null — a flag that could not overrule a default would
		 * be a flag that does nothing in the only kind of project that has one.
		 */
		const group = values.group
			? await resolveGroup(values.group, project.id, project.name)
			: null;

		const { session } = await openSession({
			projectId: project.id,
			provider,
			prompt,
			model: values.model ?? null,
			variant: values.variant ?? null,
			title: values.name ?? null,
			...(group ? { groupId: group.id } : {}),
			...(values["no-group"] ? { groupId: null } : {}),
		});

		if (values.json) {
			console.log(JSON.stringify(session, null, 2));
			return;
		}

		// Where it actually landed, not where it was asked to. Without `--group`
		// that is the project's default, which is a decision made on the caller's
		// behalf — printing the project and staying silent about the bucket would
		// be the one line that hides it.
		const landed =
			group ??
			(session.groupId
				? ((await listGroups(project.id)).find(
						(one) => one.id === session.groupId,
					) ?? null)
				: null);

		console.log(`${short(session.id)}  ${session.title}`);
		console.log(
			`  ${session.provider} · ${project.name}${
				landed ? ` · ${landed.title}` : ""
			} · ${session.state}`,
		);
	},
};
