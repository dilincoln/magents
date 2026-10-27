#!/usr/bin/env bun
/**
 * A stand-in for `claude` and `codex`, for recording the presentation video.
 *
 * magents runs whatever `claude` and `codex` are on PATH inside the daemon's
 * PTYs. Pointing PATH at `capture/bin` swaps them for this script, which draws
 * a screen shaped like each provider's own CLI, plays a scripted turn picked by
 * the prompt, and then fires the same hook the real CLIs fire — so the roster
 * pulses, the bell rings and the footer says so, exactly as it would for real.
 *
 * Nothing here talks to a model. Everything it prints is canned.
 *
 *   fake-agent.ts claude [--session-id ID | --resume ID] [--model M] [--effort E] [prompt]
 *   fake-agent.ts claude --input-format stream-json …     the SDK's model list
 *   fake-agent.ts codex  resume ID [-m M] [-c k=v] [prompt]
 *   fake-agent.ts codex  --version | app-server
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

type Provider = "claude" | "codex";

const provider = process.argv[2] as Provider;
const argv = process.argv.slice(3);

const flag = (name: string): string | undefined => {
	const at = argv.indexOf(name);
	return at >= 0 ? argv[at + 1] : undefined;
};

// ─── non-interactive entry points ────────────────────────────────────────────

if (argv.includes("--version")) {
	console.log(provider === "codex" ? "codex-cli 0.71.0" : "2.1.4 (Claude Code)");
	process.exit(0);
}

if (provider === "codex" && argv[0] === "app-server") {
	// the daemon falls back to `$CODEX_HOME/models_cache.json`, which the mock
	// setup writes
	console.error("Error: app-server is not available in this build");
	process.exit(1);
}

if (provider === "claude" && argv.includes("--input-format")) {
	await sdkModels();
	process.exit(0);
}

if (provider === "claude" && argv.includes("-p")) {
	console.log(JSON.stringify({ session_id: crypto.randomUUID() }));
	process.exit(0);
}

// ─── colours ─────────────────────────────────────────────────────────────────

const fg = (hex: string) => `\x1b[38;2;${rgb(hex)}m`;
const bg = (hex: string) => `\x1b[48;2;${rgb(hex)}m`;
const rgb = (hex: string) =>
	[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(";");
const R = "\x1b[0m";
const B = "\x1b[1m";
const D = "\x1b[2m";
const I = "\x1b[3m";

const C = {
	claude: "#d77757",
	claudeShimmer: "#eb9f7f",
	text: "#e6e6e6",
	dim: "#999999",
	faint: "#6b6b6b",
	rule: "#5a5a5a",
	ok: "#4eba65",
	err: "#ff6b80",
	addBg: "#173d1f",
	addFg: "#b5f2c0",
	delBg: "#4a1b1f",
	delFg: "#f2b5bd",
	userBg: "#373737",
	plan: "#48968c",
	codex: "#7aa2f7",
	codexCyan: "#5fd7ff",
	codexMagenta: "#c792ea",
	codexBox: "#3a3a3a",
};

// ─── the conversation ────────────────────────────────────────────────────────

type Step =
	| { kind: "say"; text: string }
	| { kind: "tool"; name: string; arg: string; result: string[]; diff?: Diff[] }
	| { kind: "todos"; items: [boolean, string][] }
	| { kind: "work"; seconds: number; verb: string }
	| { kind: "ask"; title: string; command: string; why: string };

type Diff = { n: number; sign: "+" | "-" | " "; text: string };

type Entry =
	| { kind: "user"; text: string }
	| Exclude<Step, { kind: "work" } | { kind: "ask" }>;

interface Scenario {
	match: RegExp;
	steps: Step[];
}

const scenarios: Scenario[] = [
	{
		match: /rate.?limit/i,
		steps: [
			{ kind: "say", text: "I'll look at how requests reach the public routes first." },
			{ kind: "tool", name: "Read", arg: "src/http/server.ts", result: ["Read 118 lines"] },
			{ kind: "tool", name: "Search", arg: 'pattern: "router.use", path: "src/http"', result: ["Found 4 files"] },
			{ kind: "work", seconds: 2.5, verb: "Architecting" },
			{
				kind: "todos",
				items: [
					[true, "Find where public routes are mounted"],
					[false, "Add a token-bucket limiter keyed by API key"],
					[false, "Return 429 with Retry-After"],
					[false, "Cover the limiter with tests"],
				],
			},
			{
				kind: "tool",
				name: "Write",
				arg: "src/http/rate-limit.ts",
				result: ["Wrote 46 lines to src/http/rate-limit.ts"],
				diff: [
					{ n: 1, sign: "+", text: 'import type { Middleware } from "./middleware";' },
					{ n: 2, sign: "+", text: "" },
					{ n: 3, sign: "+", text: "const CAPACITY = 120; // requests per minute" },
					{ n: 4, sign: "+", text: "const buckets = new Map<string, Bucket>();" },
				],
			},
			{ kind: "work", seconds: 600, verb: "Brewing" },
			{ kind: "tool", name: "Bash", arg: "bun test src/http", result: ["✓ 54 pass · 0 fail · 2.1s"] },
			{ kind: "say", text: "Public routes are now limited to 120 requests a minute per API key, with a 429 and Retry-After past that." },
		],
	},
	{
		match: /migrat|schema/i,
		steps: [
			{ kind: "say", text: "Reading the current users table before touching anything." },
			{ kind: "tool", name: "Read", arg: "db/schema.sql", result: ["Read 142 lines"] },
			{ kind: "tool", name: "Bash", arg: "psql -c '\\d users'", result: ["id uuid · email text · plan text · created_at timestamptz"] },
			{ kind: "work", seconds: 2, verb: "Migrating" },
			{
				kind: "tool",
				name: "Update",
				arg: "db/migrations/0012_users_v2.sql",
				result: ["Updated db/migrations/0012_users_v2.sql with 5 additions and 1 removal"],
				diff: [
					{ n: 3, sign: "-", text: "  plan text NOT NULL," },
					{ n: 3, sign: "+", text: "  plan_id uuid REFERENCES plans(id)," },
					{ n: 4, sign: "+", text: "  deleted_at timestamptz," },
					{ n: 5, sign: " ", text: "  created_at timestamptz DEFAULT now()" },
				],
			},
			{ kind: "tool", name: "Bash", arg: "bun run db:migrate && bun test db", result: ["✓ 38 pass · 0 fail · 1.9s"] },
			{ kind: "say", text: "Done. users now references plans, soft-deletes are in, and all 38 db tests pass." },
		],
	},
	{
		match: /flak|e2e|test/i,
		steps: [
			{ kind: "say", text: "I'll reproduce the flake before changing anything." },
			{ kind: "tool", name: "Ran", arg: "pnpm playwright test checkout --repeat-each=20", result: ["18 passed, 2 failed — timeout waiting for #pay-button"] },
			{ kind: "tool", name: "Explored", arg: "", result: ["Read checkout.spec.ts, use-cart.ts"] },
			{ kind: "work", seconds: 3, verb: "Working" },
			{
				kind: "tool",
				name: "Edited",
				arg: "tests/e2e/checkout.spec.ts (+2 -1)",
				result: [],
				diff: [
					{ n: 41, sign: "-", text: "    await page.click('#pay-button')" },
					{ n: 41, sign: "+", text: "    await expect(page.locator('#pay-button')).toBeEnabled()" },
					{ n: 42, sign: "+", text: "    await page.click('#pay-button')" },
				],
			},
			{ kind: "work", seconds: 600, verb: "Working" },
			{ kind: "tool", name: "Ran", arg: "pnpm playwright test checkout --repeat-each=50", result: ["50 passed (1m 48s)"] },
			{ kind: "say", text: "Fixed: the test clicked before the button was enabled. 50 runs in a row now pass." },
		],
	},
	{
		match: /review|api surface/i,
		steps: [
			{ kind: "say", text: "Collecting every exported route so the review covers the whole surface." },
			{ kind: "tool", name: "Search", arg: 'pattern: "export const .*Route"', result: ["Found 23 routes in 9 files"] },
			{ kind: "tool", name: "Read", arg: "src/http/routes/users.ts", result: ["Read 204 lines"] },
			{ kind: "work", seconds: 2, verb: "Reviewing" },
			{ kind: "ask", title: "Bash command", command: "bun test src/http/routes", why: "Run the route tests to confirm current behaviour" },
		],
	},
	{
		match: /dark mode|theme/i,
		steps: [
			{ kind: "say", text: "The settings page reads colours straight from tokens, so this is mostly plumbing." },
			{ kind: "tool", name: "Read", arg: "app/settings/page.tsx", result: ["Read 96 lines"] },
			{
				kind: "tool",
				name: "Update",
				arg: "app/settings/page.tsx",
				result: ["Updated app/settings/page.tsx with 3 additions and 1 removal"],
				diff: [
					{ n: 12, sign: "-", text: '  <main className="bg-white text-zinc-900">' },
					{ n: 12, sign: "+", text: '  <main className="bg-background text-foreground">' },
				],
			},
			{ kind: "say", text: "Settings now follows the system theme. Screenshots are in the PR description." },
		],
	},
	{
		match: /ledger|reconcil|drift/i,
		steps: [
			{ kind: "say", text: "Comparing yesterday's ledger snapshot with the bank export." },
			{ kind: "tool", name: "Bash", arg: "cargo run --bin recon -- --date 2026-10-26", result: ["3 entries differ · total drift R$ 412,90"] },
			{ kind: "work", seconds: 600, verb: "Reconciling" },
			{ kind: "say", text: "Found it: refunds booked twice when the webhook retried. Patch and backfill script are ready for review." },
		],
	},
	{
		match: /terraform|staging|infra/i,
		steps: [
			{ kind: "tool", name: "Ran", arg: "terraform -chdir=envs/staging plan", result: ["Plan: 2 to add, 1 to change, 0 to destroy."] },
			{ kind: "say", text: "The change is the new read replica and its security group. Nothing is destroyed." },
		],
	},
];

const fallback: Step[] = [
	{ kind: "say", text: "On it — reading the code around this first." },
	{ kind: "tool", name: "Read", arg: "README.md", result: ["Read 64 lines"] },
	{ kind: "work", seconds: 2.5, verb: "Thinking" },
	{ kind: "say", text: "Done. Summary of the change is above." },
];

const followUp: Step[] = [
	{ kind: "work", seconds: 1.6, verb: "Thinking" },
	{ kind: "say", text: "Good call — every 429 should say when to come back." },
	{
		kind: "tool",
		name: "Update",
		arg: "src/http/rate-limit.ts",
		result: ["Updated src/http/rate-limit.ts with 2 additions"],
		diff: [
			{ n: 31, sign: " ", text: "  if (bucket.tokens < 1) {" },
			{ n: 32, sign: "+", text: '    res.headers.set("Retry-After", String(bucket.refillIn()));' },
			{ n: 33, sign: "+", text: "    return res.status(429).json({ error: \"rate_limited\" });" },
		],
	},
	{ kind: "say", text: "Done. Every 429 now carries Retry-After, in seconds." },
];

// ─── state ───────────────────────────────────────────────────────────────────

const id =
	provider === "codex"
		? (argv[argv.indexOf("resume") + 1] ?? crypto.randomUUID())
		: (flag("--session-id") ?? flag("--resume") ?? crypto.randomUUID());
const resumed = provider === "claude" ? argv.includes("--resume") : false;

const consumed = new Set(
	["--session-id", "--resume", "--settings", "--model", "--effort", "-m", "-c"].flatMap(
		(name) => {
			const at = argv.indexOf(name);
			return at >= 0 ? [at, at + 1] : [];
		},
	),
);
if (provider === "codex") {
	const at = argv.indexOf("resume");
	if (at >= 0) consumed.add(at).add(at + 1);
}
const prompt = argv.filter((_, i) => !consumed.has(i)).at(-1);

const model =
	flag("--model") ?? flag("-m") ?? (provider === "claude" ? "opus" : "gpt-5.5-codex");
const effort =
	flag("--effort") ??
	flag("-c")?.match(/"(\w+)"/)?.[1] ??
	(provider === "claude" ? "medium" : "high");

const store = join(homedir(), ".fake-agent");
mkdirSync(store, { recursive: true });
const saved = join(store, `${id}.json`);

let history: Entry[] = [];
try {
	history = JSON.parse(readFileSync(saved, "utf8"));
} catch {}

let working: { verb: string; started: number; until: number } | null = null;
let asking: Extract<Step, { kind: "ask" }> | null = null;
let input = "";
let tick = 0;
const born = Date.now();

const save = () => writeFileSync(saved, JSON.stringify(history));

// ─── screen ──────────────────────────────────────────────────────────────────

const cols = () => process.stdout.columns || 100;
const rows = () => process.stdout.rows || 30;
const home = homedir();
const cwd = process.cwd().replace(home, "~");

const pad = (s: string, n: number) => {
	const w = visible(s);
	return w >= n ? s : s + " ".repeat(n - w);
};
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI
const visible = (s: string) => [...s.replace(/\x1b\[[0-9;]*m/g, "")].length;

const wrap = (text: string, width: number): string[] => {
	const out: string[] = [];
	let line = "";
	for (const word of text.split(" ")) {
		if (line && visible(line) + 1 + visible(word) > width) {
			out.push(line);
			line = word;
		} else line = line ? `${line} ${word}` : word;
	}
	out.push(line);
	return out;
};

const modelLabel = () => {
	if (provider === "codex") return `${model} ${effort}`;
	const name = { opus: "Opus 5.5", sonnet: "Sonnet 5.5", haiku: "Haiku 5.5" }[model] ?? model;
	return name;
};

function banner(): string[] {
	const w = cols();
	if (provider === "claude") {
		const o = fg(C.claude);
		return [
			"",
			` ${o}▐▛███▜▌${R}   ${B}Claude Code${R} ${fg(C.dim)}v2.1.4${R}`,
			`${o}▝▜█████▛▘${R}  ${fg(C.dim)}${modelLabel()} · Claude Max${R}`,
			`  ${o}▘▘ ▝▝${R}    ${fg(C.dim)}${cwd}${R}`,
			"",
		];
	}
	const inner = Math.min(w - 4, 56);
	const line = (s: string) => `${fg(C.faint)}│${R} ${pad(s, inner - 2)} ${fg(C.faint)}│${R}`;
	return [
		`${fg(C.faint)}╭${"─".repeat(inner)}╮${R}`,
		line(`${B}>_ OpenAI Codex${R} ${fg(C.dim)}(v0.71.0)${R}`),
		line(""),
		line(`${fg(C.dim)}model:${R}     ${modelLabel()}   ${fg(C.codexCyan)}/model${R}${fg(C.dim)} to change${R}`),
		line(`${fg(C.dim)}directory:${R} ${cwd}`),
		`${fg(C.faint)}╰${"─".repeat(inner)}╯${R}`,
		"",
	];
}

function renderEntry(entry: Entry): string[] {
	const w = cols() - 4;
	const claude = provider === "claude";
	switch (entry.kind) {
		case "user": {
			if (claude) {
				return [
					`${bg(C.userBg)}${fg(C.dim)}> ${fg(C.text)}${pad(entry.text, w)}${R}`,
					"",
				];
			}
			return [`${B}${fg(C.codexCyan)}›${R} ${entry.text}`, ""];
		}
		case "say": {
			const dot = claude ? `${fg(C.text)}●${R}` : `${fg(C.dim)}•${R}`;
			return [
				...wrap(entry.text, w).map((line, i) => `${i ? " " : dot} ${line}`),
				"",
			];
		}
		case "todos": {
			const head = claude
				? `${fg(C.ok)}●${R} ${B}Update Todos${R}`
				: `${fg(C.dim)}•${R} ${B}Updated Plan${R}`;
			return [
				head,
				...entry.items.map(
					([done, text], i) =>
						`  ${i ? "   " : `${fg(C.dim)}⎿${R}  `}${
							done
								? `${fg(C.dim)}☒ ${"\x1b[9m"}${text}${R}`
								: `${i === 1 ? B : ""}☐ ${text}${R}`
						}`,
				),
				"",
			];
		}
		case "tool": {
			const out: string[] = [];
			if (claude) {
				out.push(`${fg(C.ok)}●${R} ${B}${entry.name}${R}(${entry.arg})`);
				entry.result.forEach((line, i) =>
					out.push(`  ${i ? "   " : `${fg(C.dim)}⎿${R}  `}${fg(C.dim)}${line}${R}`),
				);
			} else {
				const verb = entry.name === "Edited" ? `${fg(C.ok)}${B}Edited${R}` : `${B}${entry.name}${R}`;
				out.push(`${fg(C.dim)}•${R} ${verb} ${entry.arg ? fg(C.text) + entry.arg + R : ""}`);
				for (const line of entry.result) out.push(`  ${fg(C.dim)}└ ${line}${R}`);
			}
			for (const d of entry.diff ?? []) {
				const num = String(d.n).padStart(5);
				if (claude) {
					const colour = d.sign === "+" ? bg(C.addBg) + fg(C.addFg) : d.sign === "-" ? bg(C.delBg) + fg(C.delFg) : fg(C.dim);
					out.push(`      ${fg(C.dim)}${num}${R} ${colour}${pad(`${d.sign} ${d.text}`, w - 12)}${R}`);
				} else {
					const colour = d.sign === "+" ? fg(C.ok) : d.sign === "-" ? fg(C.err) : fg(C.dim);
					out.push(`    ${fg(C.dim)}${num}${R} ${colour}${d.sign}${d.text}${R}`);
				}
			}
			out.push("");
			return out;
		}
	}
}

function footer(): string[] {
	const w = cols();
	const claude = provider === "claude";
	const out: string[] = [];

	if (working) {
		const secs = Math.floor((Date.now() - working.started) / 1000);
		if (claude) {
			const frames = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
			const glyph = frames[tick % frames.length];
			const tokens = (0.4 + secs * 0.07).toFixed(1);
			out.push(
				`${fg(C.claude)}${glyph} ${shimmer(`${working.verb}…`)}${R} ${fg(C.dim)}(${secs}s · ↓ ${tokens}k tokens · esc to interrupt)${R}`,
				"",
			);
		} else {
			const glyph = tick % 2 ? "◦" : "•";
			out.push(
				`${fg(C.dim)}${glyph}${R} ${B}${shimmer("Working")}${R} ${fg(C.dim)}(${secs}s • esc to interrupt)${R}`,
				"",
			);
		}
	}

	if (asking) {
		out.push(
			`${fg(C.rule)}${"─".repeat(w)}${R}`,
			` ${B}${fg(C.claude)}${asking.title}${R}`,
			"",
			`   ${asking.command}`,
			`   ${fg(C.dim)}${asking.why}${R}`,
			"",
			" Do you want to proceed?",
			` ${fg(C.plan)}❯ 1. Yes${R}`,
			`   2. Yes, and don't ask again for ${B}bun test${R} commands in ${cwd}`,
			`   3. No, and tell Claude what to do differently ${fg(C.dim)}(esc)${R}`,
		);
		return out;
	}

	const caret = `\x1b[7m${" "}${R}`;
	if (claude) {
		out.push(
			`${fg(C.rule)}${"─".repeat(w)}${R}`,
			`${fg(C.text)}>${R} ${input}${caret}`,
			`${fg(C.rule)}${"─".repeat(w)}${R}`,
			spread(`  ${fg(C.dim)}? for shortcuts${R}`, `${fg(C.dim)}${effortGlyph()} ${effort}${R} `, w),
		);
	} else {
		const text = input ? input + caret : `${caret}${fg(C.faint)}Ask Codex to do anything${R}`;
		out.push(
			`${bg("#262626")}${" ".repeat(w)}${R}`,
			`${bg("#262626")}${B}${fg(C.codexCyan)}›${R}${bg("#262626")} ${pad(text, w - 2)}${R}`,
			`${bg("#262626")}${" ".repeat(w)}${R}`,
			spread(`  ${fg(C.dim)}⏎ send   ⌃J newline   ⌃T transcript   ⌃C quit${R}`, `${fg(C.dim)}96% context left${R} `, w),
		);
	}
	return out;
}

const spread = (left: string, right: string, width: number) =>
	left + " ".repeat(Math.max(1, width - visible(left) - visible(right))) + right;

const effortGlyph = () => ({ low: "◔", medium: "◑", high: "◕", max: "●" })[effort] ?? "◑";

/** A moving bright band across the word, the way both CLIs animate it. */
function shimmer(word: string): string {
	const base = provider === "claude" ? C.claude : C.dim;
	const hot = provider === "claude" ? C.claudeShimmer : "#ffffff";
	const at = tick % (word.length + 6);
	return [...word]
		.map((ch, i) => `${fg(Math.abs(i - at) <= 1 ? hot : base)}${ch}`)
		.join("");
}

function draw() {
	const body = [...banner(), ...history.flatMap(renderEntry)];
	const tail = footer();
	const room = rows() - tail.length;
	const shown = body.slice(Math.max(0, body.length - room));
	while (shown.length < room) shown.push("");
	const lines = [...shown, ...tail].slice(0, rows());
	process.stdout.write(
		`\x1b[?25l\x1b[H${lines.map((l) => `${l}\x1b[K`).join("\r\n")}\x1b[J`,
	);
}

// ─── running a turn ──────────────────────────────────────────────────────────

const pace = Number(process.env.FAKE_AGENT_PACE ?? "1");
/*
 * `kill -USR1 <pid>` cuts the current wait short, so a recording decides the
 * moment a long-running agent finishes instead of waiting ten minutes for it.
 */
let wake: (() => void) | null = null;
process.on("SIGUSR1", () => wake?.());
const sleep = (ms: number) =>
	new Promise<void>((r) => {
		const timer = setTimeout(r, ms * pace);
		wake = () => {
			clearTimeout(timer);
			r();
		};
	});

let turn: Promise<void> | null = null;

async function run(steps: Step[]) {
	for (const step of steps) {
		if (step.kind === "work") {
			working = { verb: step.verb, started: Date.now(), until: Date.now() + step.seconds * 1000 };
			await sleep(step.seconds * 1000);
			working = null;
			continue;
		}
		if (step.kind === "ask") {
			asking = step;
			draw();
			hook();
			return;
		}
		working = working ?? { verb: "Thinking", started: Date.now(), until: 0 };
		await sleep(900);
		working = null;
		history.push(step);
		save();
		draw();
	}
	draw();
	hook();
}

/** What the real CLIs' Stop hook does: tell magents this session wants you. */
function hook() {
	const cli = process.env.MAGENTS_CLI;
	if (!cli || !process.env.MAGENTS_SESSION) return;
	Bun.spawn(["bun", "run", cli, "attention", "--hook"], {
		stdin: new Blob(["{}"]),
		stdout: "ignore",
		stderr: "ignore",
	});
}

function start(text: string, steps: Step[]) {
	history.push({ kind: "user", text });
	save();
	turn = run(steps).finally(() => {
		turn = null;
	});
}

// ─── input ───────────────────────────────────────────────────────────────────

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on("data", (chunk: Buffer) => {
	const s = chunk.toString("utf8");
	if (s === "\x03") process.exit(0);
	if (asking) {
		if (s === "1" || s === "\r") {
			const answered = asking;
			asking = null;
			history.push({ kind: "tool", name: "Bash", arg: answered.command, result: ["✓ 61 pass · 0 fail · 2.4s"] });
			save();
			turn = run([
				{ kind: "work", seconds: 2, verb: "Reviewing" },
				{ kind: "say", text: "All 61 route tests pass. Two routes return 200 on validation errors — flagged in REVIEW.md." },
			]);
		}
		return;
	}
	for (const ch of s) {
		if (ch === "\r") {
			if (input.trim() && !turn) {
				const text = input.trim();
				input = "";
				start(text, followUp);
			}
		} else if (ch === "\x7f") input = input.slice(0, -1);
		// biome-ignore lint/suspicious/noControlCharactersInRegex: printable only
		else if (!/[\x00-\x1f]/.test(ch)) input += ch;
	}
	draw();
});

process.stdout.on("resize", draw);
setInterval(() => {
	tick++;
	if (working || turn) draw();
}, 120);

process.stdout.write("\x1b[2J");

if (resumed || (history.length > 0 && !prompt)) {
	draw();
} else if (prompt) {
	const scenario = scenarios.find((s) => s.match.test(prompt));
	start(prompt, scenario?.steps ?? fallback);
	draw();
} else {
	draw();
}

void born;
void basename;
void I;
void D;

// ─── the SDK's model list ────────────────────────────────────────────────────

/**
 * Enough of claude's control protocol for `query().supportedModels()`: answer
 * `initialize` with the models, and keep answering until stdin closes.
 */
async function sdkModels() {
	const levels = ["low", "medium", "high", "max"];
	const models = [
		{ value: "default", displayName: "Default (recommended)", description: "Opus 5.5", resolvedModel: "claude-opus-5-5", supportedEffortLevels: levels },
		{ value: "opus", displayName: "Opus 5.5", description: "Most capable for complex work", resolvedModel: "claude-opus-5-5", supportedEffortLevels: levels },
		{ value: "sonnet", displayName: "Sonnet 5.5", description: "Best for everyday tasks", resolvedModel: "claude-sonnet-5-5", supportedEffortLevels: levels },
		{ value: "haiku", displayName: "Haiku 5.5", description: "Fastest for quick answers", resolvedModel: "claude-haiku-5-5", supportedEffortLevels: ["low", "medium", "high"] },
	];
	const decoder = new TextDecoder();
	let buffer = "";
	for await (const chunk of Bun.stdin.stream()) {
		buffer += decoder.decode(chunk);
		let at = buffer.indexOf("\n");
		while (at >= 0) {
			const line = buffer.slice(0, at);
			buffer = buffer.slice(at + 1);
			at = buffer.indexOf("\n");
			let message: { type?: string; request_id?: string; request?: { subtype?: string } };
			try {
				message = JSON.parse(line);
			} catch {
				continue;
			}
			if (message.type !== "control_request") continue;
			const response =
				message.request?.subtype === "initialize"
					? { commands: [], models, agents: [], output_style: "default", available_output_styles: ["default"], account: {} }
					: {};
			process.stdout.write(
				`${JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response } })}\n`,
			);
		}
	}
}
