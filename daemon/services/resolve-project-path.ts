import { statSync } from "node:fs";
import { resolve } from "node:path";
import { Effect } from "effect";
import { InvalidPathError } from "../errors/invalid-path-error";
import { expandHome } from "../lib/expand-home";
import { normalizePath } from "../lib/normalize-path";

/**
 * Turns whatever a caller sent into the one absolute path a project is stored
 * under, and refuses anything that is not a directory on disk.
 *
 * The check is the point. A project row is a claim that a repository is there;
 * without this the daemon would happily store a typo, and every later thing
 * that tries to use it — spawning an agent, reading a config — would be the one
 * to fail, far from the mistake.
 *
 * A relative path resolves against the daemon's own working directory, which is
 * almost never what a caller means. Send an absolute one.
 */
export const resolveProjectPath = (
	path: string,
): Effect.Effect<string, InvalidPathError> =>
	Effect.gen(function* () {
		const trimmed = path.trim();

		if (trimmed === "") {
			return yield* new InvalidPathError({ path, reason: "path is empty" });
		}

		const absolute = normalizePath(resolve(expandHome(trimmed)));

		const stats = yield* Effect.try({
			try: () => statSync(absolute),
			catch: () =>
				new InvalidPathError({ path: absolute, reason: "no such directory" }),
		});

		if (!stats.isDirectory()) {
			return yield* new InvalidPathError({
				path: absolute,
				reason: "not a directory",
			});
		}

		return absolute;
	});
