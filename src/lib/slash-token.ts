export interface SlashToken {
	/** offset of the `/` itself */
	start: number;
	/** offset just past what a completion replaces */
	end: number;
	/** the name being typed, with no trailing space */
	query: string;
	/**
	 * Whether the caret is past a space that follows the name.
	 *
	 * The difference between a search and a name. While the caret is still in the
	 * word, `/do` is someone looking — `dotnet-inspect` and `handoff` are fair
	 * answers. Once a space is typed the name is finished, and the only skill
	 * that answers to `/do` is the one called `do`.
	 */
	settled: boolean;
}

/** what ends a word */
const isBreak = (char: string | undefined) =>
	char === undefined || /\s/.test(char);
/** what does not, yet — a space after a name is still that name being looked at */
const isBlank = (char: string | undefined) => char === " " || char === "\t";

/**
 * The `/word` the caret is sitting in, or null.
 *
 * The slash has to open a word — preceded by whitespace or nothing. Without
 * that rule every path typed into the box would open the picker, and `src/lib`
 * is not someone asking for a skill.
 *
 * **A trailing space does not end it.** Typing `/do` and then a space is not
 * finishing with the picker, it is the moment right before writing what the
 * skill is for — so the caret steps back over spaces to find the name, and the
 * skill stays on screen with its description until the next real character
 * lands. A newline does end it: that is a break, not a pause.
 *
 * `query` runs to the end of the name and `end` runs past the word or to the
 * caret, whichever is further. Completing in the middle of `/rev|iewer`
 * replaces the whole word; completing after `/do |` covers the space, so the
 * result does not end up with two.
 */
export function slashTokenAt(text: string, caret: number): SlashToken | null {
	let name = caret;
	while (name > 0 && isBlank(text[name - 1])) name--;

	let start = name;
	while (start > 0 && !isBreak(text[start - 1])) start--;

	if (text[start] !== "/") return null;
	if (!isBreak(text[start - 1])) return null;

	let word = name;
	while (word < text.length && !isBreak(text[word])) word++;

	return {
		start,
		end: Math.max(word, caret),
		query: text.slice(start + 1, name),
		settled: name < caret,
	};
}
