/**
 * Aligned columns, because a list of UUIDs and titles read down a terminal is
 * only a list if the eye can find the second field without counting.
 *
 * The last column is never padded. It is the title, it is the longest thing
 * here, and trailing spaces on it are what turn a copy-paste into a bug report.
 */
export function table(rows: readonly (readonly string[])[]): string {
	const widths: number[] = [];

	for (const row of rows) {
		row.forEach((cell, at) => {
			widths[at] = Math.max(widths[at] ?? 0, cell.length);
		});
	}

	return rows
		.map((row) =>
			row
				.map((cell, at) =>
					at === row.length - 1 ? cell : cell.padEnd(widths[at] ?? 0),
				)
				.join("  ")
				.trimEnd(),
		)
		.join("\n");
}

/**
 * How much of an id to show.
 *
 * Thirteen characters, and the number is measured rather than chosen. A UUIDv7
 * opens with a 48-bit millisecond, so the first *eight* characters are its top
 * 32 bits and move once every 65 seconds — every row minted in the same minute
 * shares them, which was the first cut here and made the column decorative:
 * two sessions two minutes apart both printed `01a049fd`. Thirteen is the whole
 * timestamp, through the first dash, and separates anything not opened in the
 * same millisecond.
 *
 * Even that is not a promise, which is why nothing *resolves* by the short form
 * on its own: `find` treats a prefix as a prefix and refuses when it matches
 * twice. This is for reading, and for pasting back into a command that will
 * check it properly.
 */
export const short = (id: string): string => id.slice(0, 13);
