/**
 * Mouse input for the capture TUI, as the bytes a terminal sends with SGR
 * mouse reporting on (`\e[<b;x;yM` press/motion, `…m` release), handed to the
 * pane raw with `tmux send-keys -H` so tmux passes them straight through.
 *
 * Coordinates are 0-based cells here, 1-based on the wire.
 */

const SOCKET = "/tmp/mgv-scratch/tmux.sock";

const send = (target: string, seq: string) => {
	const hex = [...new TextEncoder().encode(seq)].map((b) => b.toString(16).padStart(2, "0"));
	Bun.spawnSync(["tmux", "-S", SOCKET, "send-keys", "-t", target, "-H", ...hex]);
};

const sgr = (button: number, x: number, y: number, release = false) =>
	`\x1b[<${button};${x + 1};${y + 1}${release ? "m" : "M"}`;

export function click(target: string, x: number, y: number) {
	send(target, sgr(0, x, y));
	send(target, sgr(0, x, y, true));
}

/** Press at the start, drag across a row cell by cell, release at the end. */
export async function drag(target: string, x0: number, x1: number, y: number, ms = 600) {
	send(target, sgr(0, x0, y));
	const steps = Math.max(1, Math.abs(x1 - x0));
	for (let i = 1; i <= steps; i++) {
		send(target, sgr(32, x0 + Math.round(((x1 - x0) * i) / steps), y));
		await Bun.sleep(ms / steps);
	}
	send(target, sgr(0, x1, y, true));
}

/**
 * Where `text` first appears on screen, as [column, row] of its first cell —
 * below the first row holding `after`, when given. Columns count characters,
 * not bytes: the roster is full of multi-byte glyphs.
 */
export function locate(target: string, text: string, after?: string): [number, number] {
	const lines = Bun.spawnSync(["tmux", "-S", SOCKET, "capture-pane", "-p", "-t", target])
		.stdout.toString()
		.split("\n");
	// below the header: its right side repeats the selected row's title, and a
	// click there lands on the header's own actions
	let from = 4;
	if (after) {
		from = lines.findIndex((line) => line.includes(after));
		if (from < 0) throw new Error(`"${after}" is not on screen`);
	}
	for (let y = from; y < lines.length; y++) {
		const at = lines[y].indexOf(text);
		if (at >= 0) return [[...lines[y].slice(0, at)].length, y];
	}
	throw new Error(`"${text}" is not on screen`);
}
