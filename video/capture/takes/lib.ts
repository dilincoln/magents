/**
 * What every take shares: the music's beat, and handles on the mock world.
 *
 * Takes schedule their keys on the track's beat grid (132.1 bpm). Played back
 * from a downbeat, a take's key presses then land on the music's beats.
 */

import { join } from "node:path";

export const BEAT = 60 / 132.1;
export const BAR = BEAT * 4;
/** beat n of the take, after a one-bar lead-in that lets the screen settle */
export const b = (n: number) => BAR + n * BEAT;

const HERE = join(import.meta.dir, "..");

interface Session {
	id: string;
	title: string;
	pid: number | null;
	requiresAttention: boolean;
}

const inns = (...args: string[]) =>
	Bun.spawnSync([join(HERE, "inns"), ...args], { cwd: HERE }).stdout.toString();

export const sessions = (): Session[] =>
	JSON.parse(inns("./mg", "sessions", "--json")).map((s: Session & { terminal?: { pid?: number } }) => ({
		...s,
		pid: s.pid ?? s.terminal?.pid ?? null,
	}));

export const session = (title: string): Session => {
	const found = sessions().find((s) => s.title.includes(title));
	if (!found) throw new Error(`no session titled ${title}`);
	return found;
};

/** Ends the fake agent's current wait, so it finishes its turn now. */
export const release = (title: string) => ["kill", "-USR1", String(pid(title))];

const pid = (title: string): number => {
	const out = inns("./mg", "sessions");
	const line = out.split("\n").find((l) => l.includes(title));
	const value = line?.trim().split(/\s+/)[3];
	if (!value || !/^\d+$/.test(value)) throw new Error(`no running pid for ${title}`);
	return Number(value);
};

/** Sets which rows are lit before a take starts. */
export function attention(lit: string[]) {
	for (const s of sessions()) {
		const on = lit.some((t) => s.title.includes(t));
		inns("./mg", "attention", s.id, ...(on ? [] : ["--clear"]));
	}
}

export const sh = (...args: string[]) => inns(...args);

export const keys = (...k: string[]) =>
	Bun.spawnSync(["tmux", "-S", "/tmp/mgv-scratch/tmux.sock", "send-keys", "-t", "main:tui", ...k]);

const screen = () =>
	Bun.spawnSync([
		"tmux",
		"-S",
		"/tmp/mgv-scratch/tmux.sock",
		"capture-pane",
		"-p",
		"-t",
		"main:tui",
	]).stdout.toString();

const header = () => screen().split("\n").slice(0, 2).join("\n");

/**
 * A clean start: sets which rows are lit, then quits and reopens the TUI.
 *
 * Reopening rather than waiting, because a row whose attention is cleared from
 * outside keeps the last colour of its pulse until something re-renders it —
 * the frame callback that painted it stops, and nothing paints it back.
 */
export async function fresh(lit: string[]) {
	// attached, every key is the agent's — spawning attaches by itself
	if (screen().includes("every other key goes to the agent")) {
		keys("C-M-Left");
		await Bun.sleep(400);
	}
	keys("Escape");
	await Bun.sleep(300);
	keys("Escape");
	await Bun.sleep(300);
	attention(lit);
	keys("q");
	await Bun.sleep(1200);
	keys("clear; magents", "Enter");
	await Bun.sleep(4500);
}

/** Moves the cursor down until the header names `title` (the roster wraps). */
export async function goto(title: string) {
	for (let i = 0; i < 40; i++) {
		if (header().includes(title)) return;
		keys("j");
		await Bun.sleep(150);
	}
	throw new Error(`never reached ${title}`);
}

/** The first row, which is the first project. */
export const home = () => goto("/home/demo/code/atlas-api");

/** Moves the cursor down `n` rows from where it is. */
export async function down(n: number) {
	for (let i = 0; i < n; i++) {
		keys("j");
		await Bun.sleep(40);
	}
	await Bun.sleep(400);
}
