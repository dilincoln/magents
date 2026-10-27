import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { magentsHome } from "../../daemon/paths/magents-home";
import type { Choice } from "./last-choice";

/**
 * What the TUI remembers about how you use it, in a file of its own.
 *
 * One file, `~/.magents/tui.json`, and one thing in it so far: the provider,
 * model and variant last spawned on, **per project**. The daemon never reads
 * it — these are not facts about sessions, they are habits of the person at
 * the keyboard, and a habit is different in every repository. The session
 * rows can say what was last spawned anywhere; only this can say what was
 * last spawned *here*, which is the question a spawn panel opening on a
 * project is actually asking.
 *
 * Keyed by the project's path rather than its id. The path is what a person
 * reads in the file, and it survives a project being forgotten and added
 * again, which an id does not.
 *
 * Read fresh each time it is wanted and written whole each time it changes,
 * both synchronously: it is a few hundred bytes, and a second TUI on the same
 * home sees a spawn the moment the first one has made it. The write goes
 * through a temporary name and a rename so a reader never sees half a file.
 */
export interface TuiPreferences {
	/** the last spawn per project, by the project's path */
	readonly lastModel: Readonly<Record<string, Choice>>;
}

const FILE = join(magentsHome, "tui.json");

const EMPTY: TuiPreferences = { lastModel: {} };

/**
 * The file, or nothing when there is none.
 *
 * A file that will not parse is treated as absent rather than as an error:
 * a preference is the one thing here that is allowed to be lost, and refusing
 * to open the spawn panel over a stray byte in it would be the wrong price.
 */
export function readPreferences(): TuiPreferences {
	try {
		const parsed = JSON.parse(
			readFileSync(FILE, "utf8"),
		) as Partial<TuiPreferences>;
		return { lastModel: isRecord(parsed.lastModel) ? parsed.lastModel : {} };
	} catch {
		return EMPTY;
	}
}

/** The last spawn in a project, when one has been made from this screen. */
export const rememberedModel = (projectPath: string): Choice | null =>
	readPreferences().lastModel[projectPath] ?? null;

/**
 * Writes one project's last spawn down, leaving every other project's alone.
 *
 * Read-modify-write on purpose: the file may have been changed by another TUI
 * since this one last read it, and a write of what this one remembers would
 * throw that away. Never throws — a preference that could not be saved is a
 * panel that opens on the old answer next time, and that is not worth an
 * error over a session that has just been opened.
 */
export function rememberModel(projectPath: string, choice: Choice): void {
	try {
		const current = readPreferences();
		const next: TuiPreferences = {
			lastModel: { ...current.lastModel, [projectPath]: choice },
		};

		mkdirSync(magentsHome, { recursive: true });
		const temporary = `${FILE}.${process.pid}.tmp`;
		writeFileSync(temporary, `${JSON.stringify(next, null, "\t")}\n`);
		renameSync(temporary, FILE);
	} catch {
		// deliberately nothing: see above
	}
}

const isRecord = (value: unknown): value is Record<string, Choice> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
