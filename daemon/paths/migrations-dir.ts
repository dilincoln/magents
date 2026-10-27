import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Where the generated SQL lives, which is not one place any more.
 *
 * Run from source it is the folder beside this one, and that was the whole of
 * this file until the daemon started being installed as a compiled binary.
 * `bun build --compile` embeds the JavaScript and nothing else: `import.meta.dir`
 * becomes `/$bunfs/root`, the migrations are not in there, and the first thing
 * the daemon does is open a database it cannot migrate. The failure is at boot
 * and it is total, so it is worth the three candidates.
 *
 * `process.execPath` is what makes the installed case work, and it is exact
 * rather than a guess: inside a compiled binary it is the binary's own path and
 * it follows the file if the file is moved (measured, both). So a daemon at
 * `<prefix>/bin/magents-daemon` finds `<prefix>/share/magents/migrations`
 * wherever the prefix turns out to be, with nothing to configure — which is why
 * the unit file `install.sh` writes sets no environment at all.
 *
 * Interpreted, `execPath` is bun itself and that candidate points somewhere
 * harmless that does not exist; the source folder is checked first anyway.
 *
 * The env override is last in usefulness and first in precedence, the same as
 * `MAGENTS_DB` and `MAGENTS_SOCKET`: whoever sets it has a reason.
 */
const candidates = (): string[] => [
	...(process.env.MAGENTS_MIGRATIONS ? [process.env.MAGENTS_MIGRATIONS] : []),
	// `import.meta.dir` is undefined under drizzle-kit's bundler, which is why
	// this lives apart from `db-path.ts` — the config file imports that one and
	// never reaches this module.
	join(import.meta.dir, "..", "migrations"),
	join(dirname(process.execPath), "..", "share", "magents", "migrations"),
];

/**
 * The first candidate that is really there, and the source one when none is —
 * a missing folder has to reach `migrate` and be reported by it, because
 * "no migrations anywhere" said from here would be a second, worse copy of the
 * same error.
 */
export const migrationsDir: string =
	candidates().find((path) =>
		existsSync(join(path, "meta", "_journal.json")),
	) ?? join(import.meta.dir, "..", "migrations");
