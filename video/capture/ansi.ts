/**
 * `tmux capture-pane -e -p` output → one HTML string per terminal row.
 *
 * tmux re-encodes the pane as plain SGR runs, one line per row, so this is a
 * small SGR interpreter rather than a terminal emulator. Every row comes out
 * exactly `cols` cells wide with explicit colours on every run, so the video
 * draws the same cells the TUI drew.
 *
 * Box-drawing and block characters are not left to the font: a font's `│`
 * stops short of the line box and the bars would show gaps. They are emitted
 * as `<i class="x" data-c="2502">` and drawn by `term.css` to fill the cell,
 * the way kitty and xterm.js draw them.
 */

export interface Theme {
	fg: string;
	bg: string;
}

interface Style {
	fg: string | null;
	bg: string | null;
	bold: boolean;
	dim: boolean;
	italic: boolean;
	underline: boolean;
	strike: boolean;
	inverse: boolean;
}

const plain = (): Style => ({
	fg: null,
	bg: null,
	bold: false,
	dim: false,
	italic: false,
	underline: false,
	strike: false,
	inverse: false,
});

const PALETTE = [
	"#000000", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5",
	"#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#ffffff",
];

const xterm256 = (n: number): string => {
	if (n < 16) return PALETTE[n];
	if (n < 232) {
		const i = n - 16;
		const v = [0, 95, 135, 175, 215, 255];
		return hex(v[Math.floor(i / 36)], v[Math.floor(i / 6) % 6], v[i % 6]);
	}
	const g = 8 + (n - 232) * 10;
	return hex(g, g, g);
};

const hex = (r: number, g: number, b: number) =>
	`#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

function applySgr(style: Style, params: number[]) {
	if (params.length === 0) params = [0];
	for (let i = 0; i < params.length; i++) {
		const p = params[i];
		if (p === 0) Object.assign(style, plain());
		else if (p === 1) style.bold = true;
		else if (p === 2) style.dim = true;
		else if (p === 3) style.italic = true;
		else if (p === 4) style.underline = true;
		else if (p === 7) style.inverse = true;
		else if (p === 9) style.strike = true;
		else if (p === 22) style.bold = style.dim = false;
		else if (p === 23) style.italic = false;
		else if (p === 24) style.underline = false;
		else if (p === 27) style.inverse = false;
		else if (p === 29) style.strike = false;
		else if (p >= 30 && p <= 37) style.fg = PALETTE[p - 30];
		else if (p >= 90 && p <= 97) style.fg = PALETTE[p - 90 + 8];
		else if (p >= 40 && p <= 47) style.bg = PALETTE[p - 40];
		else if (p >= 100 && p <= 107) style.bg = PALETTE[p - 100 + 8];
		else if (p === 39) style.fg = null;
		else if (p === 49) style.bg = null;
		else if (p === 38 || p === 48) {
			let colour: string | null = null;
			if (params[i + 1] === 2) {
				colour = hex(params[i + 2], params[i + 3], params[i + 4]);
				i += 4;
			} else if (params[i + 1] === 5) {
				colour = xterm256(params[i + 2]);
				i += 2;
			}
			if (p === 38) style.fg = colour;
			else style.bg = colour;
		}
	}
}

/** Characters drawn by CSS instead of the font. */
const DRAWN = /[\u2500-\u2503\u250c\u2510\u2514\u2518\u251c\u2524\u252c\u2534\u253c\u256d-\u2570\u2580-\u259f]/;

/** East Asian wide and emoji, roughly — two cells. */
const wide = (cp: number) =>
	(cp >= 0x1100 && cp <= 0x115f) ||
	(cp >= 0x2e80 && cp <= 0xa4cf) ||
	(cp >= 0xac00 && cp <= 0xd7a3) ||
	(cp >= 0xf900 && cp <= 0xfaff) ||
	(cp >= 0xfe30 && cp <= 0xfe4f) ||
	(cp >= 0xff00 && cp <= 0xff60) ||
	(cp >= 0x1f300 && cp <= 0x1faff);

interface Cell {
	ch: string;
	style: Style;
	width: 1 | 2;
}

export function parseScreen(text: string, cols: number, rows: number): Cell[][] {
	const lines = text.replace(/\n$/, "").split("\n");
	const grid: Cell[][] = [];
	const style = plain();
	for (let r = 0; r < rows; r++) {
		const line = lines[r] ?? "";
		const row: Cell[] = [];
		let i = 0;
		while (i < line.length) {
			if (line[i] === "\x1b") {
				// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI
				const m = /^\x1b\[([0-9;:]*)([A-Za-z])/.exec(line.slice(i));
				if (m) {
					if (m[2] === "m") {
						applySgr(style, m[1] === "" ? [] : m[1].split(/[;:]/).map((n) => Number(n || 0)));
					}
					i += m[0].length;
					continue;
				}
				// an escape tmux does not normally emit: skip the ESC alone
				i++;
				continue;
			}
			const cp = line.codePointAt(i) ?? 32;
			const ch = String.fromCodePoint(cp);
			i += ch.length;
			// combining marks ride on the previous cell
			if (cp >= 0x300 && cp <= 0x36f && row.length) {
				row[row.length - 1].ch += ch;
				continue;
			}
			const width = wide(cp) ? 2 : 1;
			row.push({ ch, style: { ...style }, width });
			if (width === 2) row.push({ ch: "", style: { ...style }, width: 1 });
		}
		// tmux trims a row's trailing default-coloured blanks; put them back with
		// the last style in force, which is what the terminal would show
		while (row.length < cols) row.push({ ch: " ", style: { ...style }, width: 1 });
		grid.push(row.slice(0, cols));
	}
	return grid;
}

const escape = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Rows as HTML. Runs of identically styled cells share one span. */
export function toHtmlRows(grid: Cell[][], theme: Theme): string[] {
	return grid.map((row) => {
		let html = "";
		let runKey = "";
		let runText = "";
		const flush = () => {
			if (!runText) return;
			html += `<span style="${runKey}">${runText}</span>`;
			runText = "";
		};
		for (const cell of row) {
			if (cell.ch === "") continue; // the right half of a wide char
			const s = cell.style;
			let fg = s.fg ?? theme.fg;
			let bg = s.bg ?? theme.bg;
			if (s.inverse) [fg, bg] = [bg, fg];
			const css = [
				`color:${fg}`,
				`background:${bg}`,
				s.bold ? "font-weight:700" : "",
				s.dim ? "opacity:.6" : "",
				s.italic ? "font-style:italic" : "",
				s.underline || s.strike
					? `text-decoration:${[s.underline && "underline", s.strike && "line-through"].filter(Boolean).join(" ")}`
					: "",
			]
				.filter(Boolean)
				.join(";");
			if (css !== runKey) {
				flush();
				runKey = css;
			}
			const ch = cell.ch;
			if (DRAWN.test(ch)) {
				runText += `<i class="x" data-c="${ch.codePointAt(0)?.toString(16)}"></i>`;
			} else if (ch.codePointAt(0)! > 0x7e || cell.width === 2) {
				// anything outside ASCII gets its own cell box, so a fallback glyph
				// with a different advance cannot push the rest of the row over
				runText += `<i class="${cell.width === 2 ? "w" : "g"}">${escape(ch)}</i>`;
			} else {
				runText += escape(ch);
			}
		}
		flush();
		return html;
	});
}

/** Every non-ASCII character in a grid, to see what the CSS has to cover. */
export function glyphs(grid: Cell[][]): Set<string> {
	const out = new Set<string>();
	for (const row of grid) for (const c of row) if (c.ch.codePointAt(0)! > 0x7e) out.add(c.ch);
	return out;
}
