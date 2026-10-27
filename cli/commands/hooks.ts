import { rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { claudeHookArgs, codexHookConfig } from "../../daemon/providers/hooks";
import { isProviderId, providerIds } from "../../daemon/providers/provider-id";
import { type Command, UsageError } from "../command";
import { spliceCodexHook } from "../lib/codex-config";

/**
 * Prints how a provider is told about our hook — the one that lights a
 * session's row when its agent stops needing the model.
 *
 * It exists because something else has to *use* that, not just read it. The
 * hook command names the installed `magents-cli` by absolute path, and codex
 * records trust against the exact string; building it a second time in shell
 * would be two implementations of one string, and the failure mode is silent —
 * a config, or a grant of trust, for a command the daemon never runs. So this
 * is the single source, read rather than reproduced.
 *
 * The two providers get very different output, and that is not an inconsistency
 * to tidy away. Claude takes its hooks as an argument, so its answer is an
 * argv. Codex takes them from its config file — see `hooks.ts` for why that
 * stopped being an argument — so its answer is a block of TOML.
 *
 *   magents hooks claude              # one argument per line
 *   magents hooks codex               # a [hooks] table
 *
 * Neither is printed with any surrounding explanation, so both can be piped.
 *
 * `--write` is the codex half doing the installing rather than describing it.
 * It could have stayed in `install.sh` — it was shell for a day — and it moved
 * here for one reason: putting a table into a config file somebody else wrote
 * means reading TOML, and the check that the result is still their config plus
 * one line means reading it again. That is a program, and shell is not where
 * you want it. See `codex-config.ts`.
 */
export const hooksCommand: Command = {
	summary: "print how a provider is told about the session hook",
	usage: `magents hooks — print how a provider is told about the session hook

usage
  magents hooks <${providerIds.join("|")}>

output
  claude   the arguments the daemon adds when it spawns an agent, one per
           line, for a shell to read back:

             args=()
             while IFS= read -r line; do args+=("$line"); done \\
               < <(magents hooks claude)

  codex    a \`[hooks]\` table for ~/.codex/config.toml, which is where codex
           takes its hooks from.

flags
      --write   codex only: put it in the config file rather than print it.
                keeps whatever hooks are already there, adding ours beside
                them, and writes nothing at all unless the result parses and
                still contains every one of them. \`install.sh\` calls this.
      --path    which file --write edits; codex's own, by default

notes
  codex only runs a hook somebody has vouched for, and it asks the first time
  it sees one. claude needs no vouching.`,

	async run(argv) {
		const { values, positionals } = parseArgs({
			args: argv,
			options: {
				write: { type: "boolean" },
				path: { type: "string" },
			},
			allowPositionals: true,
			strict: true,
		});

		const provider = positionals[0];

		if (!provider) {
			throw new UsageError(`which provider? one of ${providerIds.join(", ")}`);
		}

		if (!isProviderId(provider)) {
			throw new UsageError(
				`${provider} is not a provider — expected ${providerIds.join(" or ")}`,
			);
		}

		if (provider === "codex") {
			if (values.write) return install(values.path ?? codexConfigPath());
			console.log(codexHookConfig());
			return;
		}

		if (values.write || values.path !== undefined) {
			throw new UsageError(
				"claude takes its hooks on the command line — there is no file to write",
			);
		}

		for (const arg of claudeHookArgs()) console.log(arg);
	},
};

/** Where codex keeps its config. `CODEX_HOME` moves the whole directory. */
const codexConfigPath = (): string =>
	join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "config.toml");

/**
 * The hook, into that file, or a refusal with the reason.
 *
 * The write is a rename over the top rather than a truncate-and-fill, and the
 * staging file is beside the target rather than in a temp directory, so the two
 * are on one filesystem and the rename is atomic. A config that is half of the
 * old one and half of the new is a codex that does not start.
 */
async function install(path: string): Promise<void> {
	const file = Bun.file(path);
	const original = (await file.exists()) ? await file.text() : "";

	const splice = spliceCodexHook(original);

	if (splice.kind === "refused") {
		for (const line of splice.detail) console.error(`  ${line}`);
		throw new Error(`${path}: ${splice.note}`);
	}

	if (splice.text !== null) {
		const staged = `${path}.magents.${process.pid}`;
		await writeFile(staged, splice.text, { mode: 0o644 });
		await rename(staged, path);
	}

	console.log(`${path}: ${splice.note}`);
}
