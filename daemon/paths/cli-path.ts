import { dirname, join } from "node:path";

/**
 * How to run our own command line, as an argv the provider's hooks can use.
 *
 * The hooks the daemon installs are shell commands, and a command has to name
 * something that exists. Three candidates, the same shape and for the same
 * reason as `migrations-dir.ts`: what the daemon *is* differs between a checkout
 * and an install, and neither should have to be configured.
 *
 * Installed, `process.execPath` is the daemon binary and `magents-cli` is its
 * neighbour — put there by the same `install.sh`, so if one is on disk so is the
 * other. Interpreted, `execPath` is bun and the answer is the source tree this
 * file is in.
 *
 * `Bun.which` is the middle candidate rather than the first: PATH may well have
 * a `magents-cli`, but if this daemon was started from a directory beside one it
 * is that one the hooks should reach, not whichever copy a shell would find.
 */
export const cliCommand = (): string => {
	const beside = join(dirname(process.execPath), "magents-cli");

	if (Bun.which(beside)) return quoted(beside);

	const onPath = Bun.which("magents-cli");
	if (onPath) return quoted(onPath);

	// A checkout. `bun` is named by absolute path for the same reason as the
	// others: a hook runs under `/bin/sh` with whatever PATH the agent inherited,
	// which is not necessarily the one that started this.
	return `${quoted(process.execPath)} run ${quoted(join(import.meta.dir, "..", "..", "cli", "index.ts"))}`;
};

/**
 * Wrapped only when it has to be. A path with a space in it inside a hook's
 * command string would otherwise be two arguments, and `~/My Code/...` is a real
 * place people keep things.
 */
const quoted = (path: string): string =>
	/[^\w@%+=:,./-]/.test(path) ? `'${path.replaceAll("'", `'\\''`)}'` : path;
