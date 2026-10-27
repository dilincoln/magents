/**
 * Finding the one thing a person meant by what they typed.
 *
 * Nobody has a UUID to hand. What they have is a folder they are standing in, a
 * project name they can see in the roster, or the first few characters of an id
 * they copied off a previous command — so all three have to work, and a fourth
 * answer is needed for when they pick out more than one thing.
 *
 * Ambiguity is refused rather than resolved. Taking the first match would mean
 * `magents rename api "…"` renames a different session depending on what else
 * happens to be open, and a rename is not a thing worth guessing at.
 */
export class Ambiguous extends Error {
	constructor(what: string, ref: string, candidates: readonly string[]) {
		super(
			`${ref} matches ${candidates.length} ${what}s:\n${candidates
				.map((line) => `  ${line}`)
				.join("\n")}`,
		);
		this.name = "Ambiguous";
	}
}

/**
 * The single item whose id starts with `ref` or whose name is exactly `ref`,
 * `null` when nothing matches, and a throw when more than one does.
 *
 * Exact names beat prefixes, and that is the whole precedence rule: a project
 * literally called `api` is what somebody typing `api` meant, whatever else
 * happens to start with those three characters.
 */
export function find<T>(
	items: readonly T[],
	ref: string,
	read: (item: T) => { id: string; name: string; line: string },
	what: string,
): T | null {
	const named = items.filter((item) => read(item).name === ref);
	const hits =
		named.length > 0
			? named
			: items.filter((item) => read(item).id.startsWith(ref));

	if (hits.length === 0) return null;
	if (hits.length === 1) return hits[0] as T;

	throw new Ambiguous(
		what,
		ref,
		hits.map((item) => read(item).line),
	);
}
