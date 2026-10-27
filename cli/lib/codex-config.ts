import {
	codexHookConfig,
	codexHookEntry,
	codexHookTable,
	HOOK_EVENTS,
	type HookEvent,
	hookCommand,
} from "../../daemon/providers/hooks";

/**
 * Putting our hooks into somebody else's `~/.codex/config.toml`.
 *
 * Two of them now — `Stop` and `PermissionRequest`, see `HOOK_EVENTS` — and
 * each is its own array in the file, so everything below runs once per event
 * and the block we append holds whichever of them had to be appended. An
 * install that already has one and not the other adds the other beside it.
 *
 * This is a text edit and not a parse-and-rewrite, and that is the whole design
 * decision. A config file is a thing a person wrote: it has their comments in
 * it, their blank lines, their choice of inline table or section. Reading it
 * into an object and printing it back would produce a file that works and that
 * they did not write, and they would find out by looking for a comment that is
 * no longer there. So the file is edited where it has to be and left alone
 * everywhere else.
 *
 * What makes that safe rather than reckless is the pass at the end: every
 * candidate is parsed back and compared against the original, key by key, and
 * anything that does not come out as exactly "their config, plus one entry" is
 * thrown away unwritten. The edit is allowed to be clever because the check is
 * not.
 *
 * TOML's own rules pick the strategy, and they are worth knowing because they
 * are not obvious — measured, since guessing at codex has a poor record here:
 *
 *   nothing there yet          write a `[hooks]` table
 *   `[hooks]`, no `Stop`       append `[[hooks.Stop]]`
 *   `Stop` as `[[hooks.Stop]]` append another `[[hooks.Stop]]`
 *   `Stop = [ … ]` inline      splice into their array — the only real edit
 *
 * The three appends are legal because an array-of-tables section may start an
 * array or extend one already written that way, wherever it appears in the
 * file. The fourth is not: a `Stop` written as an inline array cannot be
 * extended by a later section — TOML calls it mutating an immutable namespace —
 * so that one case has to go inside their line.
 */

/** How our own block is found again on the next run, so it is replaced. */
const MARK_BEGIN = "# >>> magents >>>";
const MARK_END = "# <<< magents <<<";

const NOTE = [
	"# Lights a session's row in magents when a turn ends, or when codex stops",
	"# to ask. Managed by install.sh — this block is replaced on the next run,",
	"# so edits inside it are lost. `magents-cli hooks codex` prints it.",
].join("\n");

export interface Splice {
	/** `null` when the file must be left exactly as it is. */
	readonly text: string | null;
	/** One line for whoever is installing. */
	readonly note: string;
	/** Why it could not be done, when it could not. Empty otherwise. */
	readonly detail: readonly string[];
	readonly kind: "written" | "unchanged" | "refused";
}

export function spliceCodexHook(original: string): Splice {
	const stripped = strip(original);

	if (stripped === null) {
		return refused("the magents block has been edited", [
			`the file has our opening marker, ${MARK_BEGIN}, and no closing one.`,
			"working out where that block now ends means guessing what to delete,",
			"so nothing was touched. take the marker and its block out by hand.",
		]);
	}

	let before: Config;
	try {
		before = Bun.TOML.parse(stripped) as Config;
	} catch (cause) {
		return refused("the config does not parse as TOML", [
			cause instanceof Error ? cause.message : String(cause),
			"that is true before anything of ours goes in, so it is not ours to",
			"fix. sort the file out and run this again.",
		]);
	}

	const command = hookCommand();
	const missing: HookEvent[] = [];

	for (const event of HOOK_EVENTS) {
		const theirs = before.hooks?.[event];

		if (Array.isArray(theirs) && theirs.some((group) => runs(group, command))) {
			continue;
		}

		// An older install's hook, at a path this one is not using. Two would
		// mean codex running a command that may no longer exist after every
		// turn, and taking the old one out is an edit inside their array that
		// this does not attempt — it is rare, and saying so is more use than
		// guessing.
		const stale = (theirs ?? []).find((group) => magents(group));

		if (stale) {
			return refused(`an older magents hook is already in \`hooks.${event}\``, [
				"it points somewhere else, so this would leave you with two:",
				`  ${commands(stale).join("\n  ")}`,
				`the one you want now is:  ${command}`,
				"take the old entry out of your config and run this again.",
			]);
		}

		missing.push(event);
	}

	if (missing.length === 0) {
		return {
			text: null,
			note: "already there, and pointing at this install",
			detail: [],
			kind: "unchanged",
		};
	}

	const candidate = build(stripped, before, missing);

	if (candidate === null) {
		return refused("could not find where the hooks are written", [
			"the table is there but this could not place the edit, which is a gap",
			"in install.sh rather than a problem with your file. add ours to the",
			`${list(missing)} array${missing.length > 1 ? "s" : ""} you have — it is one entry each:`,
			`  ${codexHookEntry()}`,
		]);
	}

	const failure = verify(before, candidate, command, missing);

	if (failure) {
		return refused("the edit did not come out right, so it was dropped", [
			failure,
			`nothing was written. add ours to the ${list(missing)} array${missing.length > 1 ? "s" : ""} you have by hand:`,
			`  ${codexHookEntry()}`,
		]);
	}

	// The same bytes it already had, which is what a second install run produces:
	// our block is stripped and written back identically. Saying "written" would
	// be true and useless, and rewriting it would move the mtime of a file
	// nothing happened to.
	if (candidate === original) {
		return {
			text: null,
			note: "already there, and unchanged",
			detail: [],
			kind: "unchanged",
		};
	}

	const had = missing.length < HOOK_EVENTS.length || before.hooks;

	return {
		text: candidate,
		note: had
			? `added ${list(missing)} beside the hooks you already had`
			: "written",
		detail: [],
		kind: "written",
	};
}

/** `\`hooks.Stop\` and \`hooks.PermissionRequest\``, or just the one. */
const list = (events: readonly HookEvent[]): string =>
	events.map((event) => `\`hooks.${event}\``).join(" and ");

/**
 * The file without any block we wrote before, or `null` when the block has been
 * opened and not closed.
 *
 * The null matters more than it looks. Dropping from an unmatched opening
 * marker to the end of the file would be right while our block is still last
 * and silently destructive the moment anything has been added after it, and
 * there is no reading of the file that tells the two apart.
 */
function strip(text: string): string | null {
	const lines = text.split("\n");
	const kept: string[] = [];
	let inside = false;
	let opened = false;

	for (const line of lines) {
		if (line.trim() === MARK_BEGIN) {
			inside = true;
			opened = true;
			continue;
		}
		if (line.trim() === MARK_END) {
			inside = false;
			continue;
		}
		if (!inside) kept.push(line);
	}

	if (inside && opened) return null;

	return `${kept.join("\n").replace(/\n+$/, "")}\n`.replace(/^\n$/, "");
}

/**
 * The candidate file, with every missing event put in by whichever of the four
 * routes applies to it.
 *
 * The routes that append all land in one block at the end, between one pair of
 * markers, however many events had to go there. The route that inserts edits
 * their line in place and is applied first, so the offsets it works on are the
 * ones in the file they wrote.
 */
function build(
	text: string,
	before: Config,
	events: readonly HookEvent[],
): string | null {
	if (!before.hooks) return append(text, codexHookConfig());

	let out = text;
	const tables: string[] = [];

	for (const event of events) {
		if (!before.hooks[event] || section(event).test(text)) {
			// no such array yet, or one written as sections, which can simply be
			// extended by another one
			tables.push(codexHookTable(event));
			continue;
		}

		const inserted = insert(out, event);
		if (inserted === null) return null;
		out = inserted;
	}

	return tables.length > 0 ? append(out, tables.join("\n\n")) : out;
}

/** `[[hooks.<event>]]`, as a header line, however it is spaced. */
const section = (event: HookEvent): RegExp =>
	new RegExp(
		`^[ \\t]*\\[\\[[ \\t]*hooks[ \\t]*\\.[ \\t]*${event}[ \\t]*\\]\\]`,
		"m",
	);

/** Our block at the end, between markers so the next run replaces it. */
const append = (text: string, block: string): string =>
	[text.replace(/\n*$/, ""), "", MARK_BEGIN, NOTE, block, MARK_END, ""]
		.join("\n")
		.replace(/^\n+/, "");

/**
 * Our entry at the front of their inline array for the event.
 *
 * At the front rather than the end because the front is one character to find —
 * the `[` that opens the value — while the end means matching brackets through
 * however many nested inline tables they wrote. Order carries no meaning here:
 * codex runs every group in the array, and ours is a group of its own.
 *
 * The search is scoped to their `[hooks]` table rather than run over the whole
 * file, because `Stop = [` is a plausible key in somebody else's table too. A
 * dotted `hooks.Stop = [` at the top level names itself and is looked for
 * directly.
 */
function insert(text: string, event: HookEvent): string | null {
	const dotted =
		new RegExp(
			`^[ \\t]*hooks[ \\t]*\\.[ \\t]*${event}[ \\t]*=[ \\t]*\\[`,
			"m",
		).exec(text) ?? null;

	if (dotted) return splice(text, dotted.index + dotted[0].length);

	const header = /^[ \t]*\[[ \t]*hooks[ \t]*\][ \t]*$/m.exec(text);
	if (!header) return null;

	const from = header.index + header[0].length;
	const rest = text.slice(from);
	// the table runs to the next header, or to the end of the file
	const until = /^[ \t]*\[/m.exec(rest);
	const table = rest.slice(0, until ? until.index : rest.length);

	const key = new RegExp(`^[ \\t]*${event}[ \\t]*=[ \\t]*\\[`, "m").exec(table);
	if (!key) return null;

	return splice(text, from + key.index + key[0].length);
}

const splice = (text: string, at: number): string =>
	`${text.slice(0, at)}${codexHookEntry()}, ${text.slice(at)}`;

/**
 * That the candidate is their config with exactly one entry added per event
 * asked for, and nothing else about it different.
 *
 * Returns the complaint, or `null` when there is nothing to complain about.
 * Everything above is allowed to edit text on a pattern match because this runs
 * afterwards: a regex that matched in the wrong table, a bracket counted wrong,
 * a strategy picked for the wrong shape all come out here as a config that is
 * not the one that was asked for, and a candidate that is not written costs
 * nothing.
 */
function verify(
	before: Config,
	candidate: string,
	command: string,
	events: readonly HookEvent[],
): string {
	let after: Config;

	try {
		after = Bun.TOML.parse(candidate) as Config;
	} catch (cause) {
		return `the result is not valid TOML: ${cause instanceof Error ? cause.message : String(cause)}`;
	}

	for (const event of HOOK_EVENTS) {
		const was = before.hooks?.[event] ?? [];
		const now = after.hooks?.[event] ?? [];

		if (!Array.isArray(now))
			return `\`hooks.${event}\` did not come out as an array`;

		// an event that was already there and not asked for has to come out
		// exactly as it went in
		if (!events.includes(event)) {
			if (!same(now, was))
				return `\`hooks.${event}\` changed, and was not meant to`;
			continue;
		}

		if (now.length !== was.length + 1) {
			return `\`hooks.${event}\` went from ${was.length} to ${now.length} entries, expected ${was.length + 1}`;
		}

		// Every entry they had, still there and unchanged. Consumed one at a
		// time so that two identical entries have to survive as two.
		const left = [...now];

		for (const group of was) {
			const at = left.findIndex((one) => same(one, group));
			if (at === -1)
				return `an entry that was in \`hooks.${event}\` is not any more`;
			left.splice(at, 1);
		}

		const added = left[0];

		if (!added || !runs(added, command)) {
			return `the entry added to \`hooks.${event}\` does not run this install's command`;
		}
	}

	// And nothing outside those arrays moved: their other hooks, their model,
	// their servers, their everything.
	if (!same(without(before), without(after))) {
		return "something outside our hook arrays changed";
	}

	return "";
}

/**
 * The config with our events' arrays taken out, which is the part we may touch.
 *
 * A `hooks` table left with nothing in it is dropped rather than kept as an
 * empty object, and that is not tidiness. Writing the first hook into a file
 * that had no `hooks` at all turns "no key" into "a key holding only the thing
 * we are allowed to add", and comparing those two literally reported every
 * clean install as a config we had changed behind the user's back.
 */
const without = (config: Config): unknown => {
	const { hooks, ...rest } = config;
	if (!hooks) return rest;

	const others = Object.fromEntries(
		Object.entries(hooks).filter(
			([key]) => !(HOOK_EVENTS as readonly string[]).includes(key),
		),
	);

	return Object.keys(others).length > 0 ? { ...rest, hooks: others } : rest;
};

/**
 * Deep equality, by writing both out with their keys in a fixed order.
 *
 * Plain `JSON.stringify` would do if key order could be relied on, and it
 * cannot: the order is whatever the parser happened to see, and our edit moves
 * where a key is written.
 */
const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

const canonical = (value: unknown): string => {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;

	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.sort(([a], [b]) => (a < b ? -1 : 1))
			.map(([key, one]) => `${JSON.stringify(key)}:${canonical(one)}`);

		return `{${entries.join(",")}}`;
	}

	return JSON.stringify(value) ?? "null";
};

/** Whether a hook group runs this exact command. */
const runs = (group: unknown, command: string): boolean =>
	commands(group).includes(command);

/** Whether a group is one of ours, from this install or an older one. */
const magents = (group: unknown): boolean =>
	commands(group).some((one) => one.endsWith("attention --hook"));

/** The commands a hook group runs, however sparsely it is filled in. */
function commands(group: unknown): string[] {
	const hooks = (group as { hooks?: unknown } | null)?.hooks;
	if (!Array.isArray(hooks)) return [];

	return hooks
		.map((hook) => (hook as { command?: unknown } | null)?.command)
		.filter((command): command is string => typeof command === "string");
}

const refused = (note: string, detail: readonly string[]): Splice => ({
	text: null,
	note,
	detail,
	kind: "refused",
});

interface Config {
	hooks?: Partial<Record<HookEvent, unknown[]>> & Record<string, unknown>;
	[key: string]: unknown;
}
