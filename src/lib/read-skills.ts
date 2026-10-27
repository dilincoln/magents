import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderId } from "./agents";
import { parseFrontmatter } from "./parse-frontmatter";
import { pluginSkillRoots } from "./plugin-skill-roots";

export type SkillScope = "global" | "local";

export interface Skill {
	name: string;
	description: string;
	/** the SKILL.md itself, not the folder */
	path: string;
	/** whose convention it was found under — this is the mark in the picker */
	provider: ProviderId;
	scope: SkillScope;
	/** the plugin it came with, when it did not come from a skills folder */
	plugin?: string;
}

/**
 * Where each provider keeps them. Global is per user, local is per repository,
 * and codex's local folder is the shared `.agents/` one rather than its own.
 */
const roots: Record<ProviderId, Record<SkillScope, string>> = {
	claude: {
		global: join(homedir(), ".claude", "skills"),
		local: join(".claude", "skills"),
	},
	codex: {
		global: join(homedir(), ".codex", "skills"),
		local: join(".agents", "skills"),
	},
};

/**
 * Every skill available in a project, from both providers, global and local.
 *
 * One flat list rather than a shape per provider, and every provider read
 * whoever is asking. The spawn form shows one provider's at a time and narrows
 * this list itself, which is cheaper than it sounds: the four directories are
 * read once per project and cycling `⌃p` costs a filter rather than four more
 * `readdir`s and a `SKILL.md` in every folder.
 *
 * Plugins are a fifth source and they do not live anywhere guessable: their
 * skills sit in a per-version cache, and the only thing that knows which
 * version is installed is claude's own manifest. See `pluginSkillRoots`.
 *
 * A missing directory is not an error. Most machines have two of these four,
 * and the absence of `~/.codex/skills` is not something to report.
 *
 * Duplicates across providers are kept. The same skill name under `.claude` and
 * `.codex` is two files with two owners, and nothing here has to choose between
 * them — the caller knows which provider it is about to run.
 */
export async function readSkills(projectPath: string): Promise<Skill[]> {
	const dirs = (["claude", "codex"] as const).flatMap((provider) =>
		(["local", "global"] as const).map((scope) => ({
			provider,
			scope,
			dir:
				scope === "local"
					? join(projectPath, roots[provider].local)
					: roots[provider].global,
		})),
	);

	const found = await Promise.all([
		...dirs.map(({ provider, scope, dir }) =>
			readSkillsIn(dir, provider, scope),
		),
		...(await pluginSkillRoots()).map(({ plugin, scope, dir }) =>
			// plugins are claude's; the manifest is claude's. `user` and `project`
			// are the manifest's own words for the same two scopes.
			readSkillsIn(
				dir,
				"claude",
				scope === "project" ? "local" : "global",
				plugin,
			),
		),
	]);

	// local before global at the same name: the repository's version of a skill
	// is the one that wins, so it is the one listed first
	return found
		.flat()
		.sort(
			(a, b) =>
				a.name.localeCompare(b.name) ||
				a.scope.localeCompare(b.scope) ||
				a.provider.localeCompare(b.provider),
		);
}

/**
 * Every skill under a directory, whether it holds them flat or in categories.
 *
 * Both layouts are real: `~/.claude/skills/<name>/SKILL.md` is the common one,
 * and a plugin like `mattpocock-skills` files them under
 * `skills/<category>/<name>/SKILL.md`. A flat read finds nothing at all in the
 * second — which is what happened.
 *
 * So: a folder holding a `SKILL.md` is a skill and is not descended into;
 * anything else is a category and is, up to `depth`. Bounded rather than a full
 * walk, because a plugin is a checked-out repository — `node_modules` and its
 * own dot-directories are down there, and neither holds skills.
 */
async function readSkillsIn(
	dir: string,
	provider: ProviderId,
	scope: SkillScope,
	plugin?: string,
	depth = 2,
): Promise<Skill[]> {
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return [];
	}

	const found = await Promise.all(
		entries
			.filter((entry) => !entry.startsWith(".") && entry !== "node_modules")
			.map(async (entry): Promise<Skill[]> => {
				const folder = join(dir, entry);
				const path = join(folder, "SKILL.md");

				let content: string;
				try {
					content = await readFile(path, "utf-8");
				} catch {
					// not a skill; it may still be a shelf of them
					return depth > 0
						? readSkillsIn(folder, provider, scope, plugin, depth - 1)
						: [];
				}

				const { name, description } = parseFrontmatter(content);
				return [
					{
						name: name ?? entry,
						description: description ?? "",
						path,
						provider,
						scope,
						...(plugin ? { plugin } : {}),
					},
				];
			}),
	);

	return found.flat();
}
