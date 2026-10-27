/**
 * Word-wraps `text` to `width` columns, at most `maxLines` lines, with `…` on
 * the last one when there was more.
 *
 * Done by hand because OpenTUI gives two of the three pieces and categorically
 * not the third. A `<text>` already wraps at its own width (`wrapMode` defaults
 * to `"word"`), and a fixed `height` already clips the extra rows — but nothing
 * marks the cut. The one native ellipsis, `truncate`, is single-line, works only
 * with `wrapMode: "none"`, and puts the dots in the *middle*. OpenTUI's own
 * widgets reach for the same manual cut: `TabSelectRenderable.truncateText` is
 * `text.substring(0, maxWidth - 1) + "…"`.
 *
 * The `…` is counted inside `width`. A line that ends one column past the box
 * does not clip the tail, it loses the ellipsis — the marker is the first thing
 * to go, which is the one character that must not.
 *
 * Over-long words are hard-split at the boundary, which is what `wrapMode:
 * "word"` does natively too. Render the result as one `<text>` joined with
 * newlines and `wrapMode: "none"`, so that a `width` a column too generous
 * clips a tail instead of silently producing a fourth row.
 */
export function wrapClamped(
	text: string,
	width: number,
	maxLines: number,
): string[] {
	if (width <= 1 || maxLines <= 0) return [];

	const words = text.trim().split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let line = "";

	const flush = () => {
		if (line !== "") {
			lines.push(line);
			line = "";
		}
	};

	for (const original of words) {
		let word = original;

		while (word.length > width) {
			flush();
			lines.push(word.slice(0, width));
			word = word.slice(width);
		}

		if (line === "") line = word;
		else if (line.length + 1 + word.length <= width) line += ` ${word}`;
		else {
			flush();
			line = word;
		}
	}
	flush();

	if (lines.length <= maxLines) return lines;

	const kept = lines.slice(0, maxLines);
	const last = kept[maxLines - 1] ?? "";
	const room = width - 1;
	kept[maxLines - 1] =
		`${(last.length > room ? last.slice(0, room) : last).trimEnd()}…`;
	return kept;
}
