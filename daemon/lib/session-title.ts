/** The first line, and not too much of it — the row it titles is narrow. */
export const TITLE_LIMIT = 120;

/**
 * A title out of whatever text was offered, or null when there was none.
 *
 * One line, because a title is read in a list and a list has one line per row.
 * Clamped, because the sidebar is twenty-six columns wide and a paragraph
 * pasted into the name field would be a paragraph stored forever.
 *
 * Null rather than a default: the three callers want different fallbacks — a
 * prompt that was blank, an import with nothing in the transcript and a rename
 * are three situations, not one — so the substitute is theirs to choose and
 * this only reports that there is nothing to work with.
 */
export const sessionTitle = (
	text: string | null | undefined,
): string | null => {
	const first = text?.trim().split("\n")[0]?.trim();

	if (!first) return null;

	return first.length > TITLE_LIMIT
		? `${first.slice(0, TITLE_LIMIT - 1)}…`
		: first;
};
