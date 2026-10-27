import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface PluginSkillRoot {
	/** the plugin it came from, without its marketplace */
	plugin: string;
	/** the manifest's own word for where it was installed */
	scope: "user" | "project";
	/** the directory holding one folder per skill */
	dir: string;
}

const manifestPath = join(
	homedir(),
	".claude",
	"plugins",
	"installed_plugins.json",
);

/**
 * Where the skills of installed plugins live.
 *
 * Read from the manifest and nowhere else, because the two obvious places to
 * look are both wrong:
 *
 * - `plugins/marketplaces/…` is the **catalogue**, every plugin on offer.
 *   Walking it lists hundreds of skills nobody installed.
 * - `plugins/cache/…` keeps **every version ever fetched** side by side —
 *   `superpowers/6.2.0` next to `superpowers/6.3.0`. Globbing it shows the same
 *   skill twice, one of them stale.
 *
 * `installed_plugins.json` is the only thing that knows which version is the
 * installed one, and it says so as an absolute `installPath`.
 *
 * Claude-only: codex has no plugin directory on disk today.
 */
export async function pluginSkillRoots(): Promise<PluginSkillRoot[]> {
	let manifest: unknown;
	try {
		manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
	} catch {
		// no plugins installed, or nothing readable — not a thing to report
		return [];
	}

	const plugins =
		typeof manifest === "object" && manifest !== null && "plugins" in manifest
			? (manifest as { plugins: unknown }).plugins
			: undefined;

	if (typeof plugins !== "object" || plugins === null) return [];

	const roots: PluginSkillRoot[] = [];

	for (const [id, installs] of Object.entries(plugins)) {
		if (!Array.isArray(installs)) continue;

		// "superpowers@claude-plugins-official" — the marketplace is provenance,
		// not something to put in front of anyone picking a skill
		const plugin = id.split("@")[0] ?? id;

		for (const install of installs) {
			const path = (install as { installPath?: unknown })?.installPath;
			if (typeof path !== "string") continue;

			const scope = (install as { scope?: unknown })?.scope;
			roots.push({
				plugin,
				scope: scope === "project" ? "project" : "user",
				dir: join(path, "skills"),
			});
		}
	}

	return roots;
}
