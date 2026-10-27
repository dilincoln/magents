/**
 * Wordmark geometry and colour, with no React and no renderable attached.
 *
 * OpenTUI's ASCIIFontRenderable colours a glyph by the font's own colour layers,
 * which is one flat colour for `tiny`. So we assemble the glyph rows from the
 * font data and emit one styled chunk per column — that is what buys the
 * per-column control the sweep needs.
 */
import { fonts, RGBA, StyledText, type TextChunk } from "@opentui/core";
import { theme } from "./theme";

/** seconds for one pass, including the rest before the band comes back */
export const CYCLE = 2.6;
/** half-width of the band, as a fraction of the wordmark */
export const BAND = 0.28;
/** intensity the mark sits at when nothing is running */
export const RESTING = 0.55;

export interface Column {
	/** the glyph character on each row */
	chars: string[];
	/** 0..1 across the wordmark */
	u: number;
}

export interface Ramp {
	dim: RGBA;
	bright: RGBA;
}

const mix = (a: RGBA, b: RGBA, amount: number): RGBA =>
	RGBA.fromValues(
		a.r + (b.r - a.r) * amount,
		a.g + (b.g - a.g) * amount,
		a.b + (b.b - a.b) * amount,
		1,
	);

/** Assembles the glyph rows from the raw font data. */
export function buildColumns(
	text: string,
	font: keyof typeof fonts = "tiny",
): Column[] {
	const def = fonts[font];
	const glyphs = def.chars as unknown as Record<string, string[] | undefined>;
	const rows: string[] = Array.from({ length: def.lines }, () => "");

	for (let i = 0; i < text.length; i++) {
		const glyph = glyphs[text[i]!.toUpperCase()] ?? glyphs[" "];
		if (!glyph) continue;

		const width = glyph[0]?.length ?? 0;
		for (let line = 0; line < def.lines; line++)
			rows[line] += glyph[line] ?? " ".repeat(width);
		if (i < text.length - 1) {
			for (let line = 0; line < def.lines; line++)
				rows[line] += def.letterspace[line] ?? " ";
		}
	}

	const width = rows[0]?.length ?? 0;
	return Array.from({ length: width }, (_, x) => ({
		chars: rows.map((row) => row[x] ?? " "),
		u: width > 1 ? x / (width - 1) : 0,
	}));
}

/** The base gradient never changes, so bake the two ends of each column's ramp. */
export function buildRamp(columns: Column[]): Ramp[] {
	const from = RGBA.fromHex(theme.accent);
	const to = RGBA.fromHex(theme.violet);
	const floor = RGBA.fromHex(theme.bg);
	const ceiling = RGBA.fromHex("#ffffff");

	return columns.map((column) => {
		const base = mix(from, to, column.u);
		return { dim: mix(floor, base, 0.62), bright: mix(base, ceiling, 0.5) };
	});
}

/**
 * Band intensity at column `u`, `t` seconds in. The head overshoots both ends so
 * the band enters and leaves cleanly instead of popping.
 */
export function sweepLevel(u: number, t: number): number {
	const head = ((t % CYCLE) / CYCLE) * 1.5 - 0.25;
	const falloff = Math.max(0, 1 - Math.abs(u - head) / BAND) ** 2;
	return 0.2 + 0.8 * falloff;
}

/** Paints the columns at the given intensity, one chunk per column. */
export function paintWordmark(
	columns: Column[],
	ramp: Ramp[],
	level: (u: number) => number,
): StyledText {
	const rowCount = columns[0]?.chars.length ?? 0;
	const chunks: TextChunk[] = [];

	for (let row = 0; row < rowCount; row++) {
		if (row > 0) chunks.push({ __isChunk: true, text: "\n" });
		for (let x = 0; x < columns.length; x++) {
			const column = columns[x]!;
			const { dim, bright } = ramp[x]!;
			chunks.push({
				__isChunk: true,
				text: column.chars[row]!,
				fg: mix(dim, bright, level(column.u)),
			});
		}
	}

	return new StyledText(chunks);
}
