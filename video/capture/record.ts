#!/usr/bin/env bun
/**
 * Records a "take": drives the real TUI in the capture tmux server with a
 * scripted sequence of keys while sampling the screen, and writes every
 * distinct screen to `takes/<name>.js` for the video to play back.
 *
 *   bun capture/record.ts <take>          runs capture/takes/<take>.ts
 *   bun capture/record.ts --shot <name>   one frame of whatever is on screen
 *
 * A take file is rows deduplicated into a dictionary plus, per frame, its time
 * and the row indices — screens change a few rows at a time, so this keeps a
 * thirty-second take to a few hundred kilobytes.
 *
 * A take may watch more than one pane (`panes`), each written to its own file
 * as `<take>-<pane>`, sampled in the same loop so their clocks agree.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { glyphs, parseScreen, toHtmlRows } from "./ansi";
import { click, drag, locate } from "./mouse";

const SOCKET = "/tmp/mgv-scratch/tmux.sock";
const THEME = { fg: "#dbe2f5", bg: "#0a0c14" };
const HERE = import.meta.dir;
const OUT = join(HERE, "..", "takes");

/**
 * `label` on a key action writes it to the take's `events`, for the film to
 * show as a keycap. Mouse actions are always written there, with the cell they
 * hit, so the film can draw the pointer where the click really landed.
 *
 * `click` and `drag` name text on screen rather than coordinates: the cell is
 * looked up when the action runs, `after` first finding a row to search below,
 * `dx` moving into the text from its first character.
 */
export type Action = { at: number } & (
	| { keys: string[]; target?: string; label?: string }
	| { type: string; cps?: number; target?: string }
	| { run: string[] }
	| { click: string; after?: string; dx?: number; target?: string }
	| { drag: string; length: number; ms?: number; target?: string }
	| { clickAt: [number, number]; target?: string }
	| { end: true }
);

export type Event =
	| { t: number; kind: "key"; label: string }
	| { t: number; kind: "click"; x: number; y: number }
	| { t: number; kind: "drag"; x: number; y: number; x1: number; ms: number };

export interface Take {
	actions: Action[];
	fps?: number;
	/** name → tmux target; defaults to the TUI alone */
	panes?: Record<string, string>;
	/** runs before the clock starts */
	setup?: () => void | Promise<void>;
}

export const tmux = (...args: string[]) =>
	Bun.spawnSync(["tmux", "-S", SOCKET, ...args]).stdout.toString();

const size = (target: string): [number, number] => {
	const [c, r] = tmux("display", "-p", "-t", target, "#{pane_width} #{pane_height}")
		.trim()
		.split(" ")
		.map(Number);
	return [c, r];
};

interface Frame {
	t: number;
	rows: number[];
	cursor: [number, number] | null;
}

class Track {
	dict: string[] = [];
	index = new Map<string, number>();
	frames: Frame[] = [];
	last = "";
	seen = new Set<string>();
	cols: number;
	rows: number;

	constructor(
		readonly name: string,
		readonly target: string,
	) {
		[this.cols, this.rows] = size(target);
	}

	sample(now: number) {
		const text = tmux("capture-pane", "-e", "-p", "-N", "-t", this.target);
		const [x, y, on] = tmux(
			"display",
			"-p",
			"-t",
			this.target,
			"#{cursor_x} #{cursor_y} #{cursor_flag}",
		)
			.trim()
			.split(" ")
			.map(Number);
		const grid = parseScreen(text, this.cols, this.rows);
		for (const g of glyphs(grid)) this.seen.add(g);
		const ids = toHtmlRows(grid, THEME).map((row) => {
			let i = this.index.get(row);
			if (i === undefined) {
				i = this.dict.length;
				this.dict.push(row);
				this.index.set(row, i);
			}
			return i;
		});
		const cursor = on ? ([x, y] as [number, number]) : null;
		const key = `${ids.join(",")}|${cursor?.join(",")}`;
		if (key !== this.last) {
			this.frames.push({ t: Math.round(now * 1000) / 1000, rows: ids, cursor });
			this.last = key;
		}
	}

	write(duration: number, events: Event[]) {
		mkdirSync(OUT, { recursive: true });
		// a script rather than JSON, so the composition loads it with a <script>
		// tag before the first frame instead of fetching it
		const file = join(OUT, `${this.name}.js`);
		const take = JSON.stringify({
			name: this.name,
			cols: this.cols,
			rows: this.rows,
			duration,
			rowsDict: this.dict,
			frames: this.frames,
			events,
		});
		writeFileSync(file, `(window.TAKES = window.TAKES || {})[${JSON.stringify(this.name)}] = ${take};\n`);
		console.log(
			`${file}: ${this.frames.length} frames, ${this.dict.length} rows, ${duration}s — ${[...this.seen].join("")}`,
		);
	}
}

async function record(name: string, take: Take) {
	const fps = take.fps ?? 30;
	const panes = take.panes ?? { "": "main:tui" };
	await take.setup?.();
	const tracks = Object.entries(panes).map(
		([pane, target]) => new Track(pane ? `${name}-${pane}` : name, target),
	);
	const primary = Object.values(panes)[0];

	const end = Math.max(...take.actions.map((a) => a.at));
	const pending = [...take.actions].sort((a, b) => a.at - b.at);
	const typing: Promise<void>[] = [];
	const events: Event[] = [];
	const t0 = performance.now();

	while (true) {
		const now = (performance.now() - t0) / 1000;
		const t = Math.round(now * 1000) / 1000;
		while (pending.length && pending[0].at <= now) {
			const a = pending.shift()!;
			const target = ("target" in a && a.target) || primary;
			if ("keys" in a) {
				tmux("send-keys", "-t", target, ...a.keys);
				if (a.label) events.push({ t, kind: "key", label: a.label });
			} else if ("type" in a) typing.push(typeOut(a.type, a.cps ?? 14, target));
			else if ("run" in a) Bun.spawn(a.run, { cwd: HERE, stdout: "ignore", stderr: "ignore" });
			else if ("click" in a) {
				const [x, y] = locate(target, a.click, a.after);
				console.error(`  click "${a.click}" at ${x + (a.dx ?? 1)},${y} (t=${t})`);
				click(target, x + (a.dx ?? 1), y);
				events.push({ t, kind: "click", x: x + (a.dx ?? 1), y });
			} else if ("clickAt" in a) {
				click(target, a.clickAt[0], a.clickAt[1]);
				events.push({ t, kind: "click", x: a.clickAt[0], y: a.clickAt[1] });
			} else if ("drag" in a) {
				const [x, y] = locate(target, a.drag);
				const ms = a.ms ?? 700;
				typing.push(drag(target, x, x + a.length, y, ms));
				events.push({ t, kind: "drag", x, y, x1: x + a.length, ms });
			}
		}
		if (now > end) break;
		for (const track of tracks) track.sample(now);
		const next = t0 + (Math.floor(((performance.now() - t0) / 1000) * fps) + 1) * (1000 / fps);
		await Bun.sleep(Math.max(0, next - performance.now()));
	}
	await Promise.all(typing);
	for (const track of tracks) track.write(end, events);
}

async function typeOut(text: string, cps: number, target: string) {
	for (const ch of text) {
		// a lone `;` is tmux's own command separator, even after -l
		tmux("send-keys", "-t", target, "-l", ch === ";" ? "\\;" : ch);
		await Bun.sleep(1000 / cps);
	}
}

if (import.meta.main) {
	const [arg, name] = process.argv.slice(2);
	if (arg === "--shot") {
		await record(name ?? "shot", { actions: [{ at: 0.05, end: true }] });
	} else if (arg) {
		const take = (await import(join(HERE, "takes", `${arg}.ts`))).default as Take;
		await record(arg, take);
	} else {
		console.error("usage: record.ts <take> | --shot <name>");
		process.exit(1);
	}
}
