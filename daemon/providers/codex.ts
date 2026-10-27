import { mkdir, open as openFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { ProviderError } from "../errors/provider-error";
import { expire } from "../lib/expire";
import type { Model } from "./model";
import type { ProviderAdapter } from "./provider-adapter";
import type { FoundSession, Launch, SessionSpec } from "./session-spec";

/**
 * Codex, asked over its app-server, and read off its own cache when the
 * server will not answer.
 *
 * There is no `codex models --json`. The list lives behind the same JSON-RPC
 * server the editor extensions talk to, so getting it means starting one,
 * shaking hands, asking, and killing it — a few hundred milliseconds, which is
 * why the client caches the answer rather than the daemon. The server is the
 * authority and is asked first: it is what codex itself shows, refreshed from
 * the API when it can be.
 *
 * It is not always able to answer, and the failure is not about the models.
 * Starting the server opens every SQLite database under `~/.codex`, and one
 * of them — `logs_2.sqlite`, telemetry, hundreds of megabytes on a machine
 * that has used codex for a while — is opened with a flat five-second lock
 * timeout and no retry. Any other codex holding it a moment too long, an
 * extension's server, a session of ours, a suspended TUI, and the list came
 * back as "failed to initialize sqlite state runtime" on a spawn panel that
 * had only asked what models there are. That is codex's bug, and it is not
 * one the panel should be able to hit.
 *
 * What codex does have is the file it keeps the answer in —
 * `models_cache.json`, refreshed on every run it makes — and the server's own
 * answer is that file's `visibility = "list"` rows in `priority` order with
 * the first marked default, compared entry by entry. So when the server
 * fails, the file is read instead, and only a codex that has never run has
 * neither. The server's complaint is kept for that case, with a line about
 * what it usually means.
 */
export const codexAdapter: ProviderAdapter = {
	id: "codex",
	listModels: Effect.tryPromise({
		try: listCodexModels,
		catch: (cause) =>
			new ProviderError({
				provider: "codex",
				reason: cause instanceof Error ? cause.message : String(cause),
				cause,
			}),
	}),

	/*
	 * Nothing is run. The session is written down, and codex is told to resume
	 * it.
	 *
	 * Codex has no `--session-id`, and two earlier versions of this file paid
	 * for that in full: `exec` ran the whole first turn headlessly to learn what
	 * id codex had chosen, and an `adopt` went reading rollouts to find it when
	 * the run had not said. Two minutes and eight seconds, measured, against a
	 * claude session that answered instantly.
	 *
	 * What codex does have is `resume`, and `resume` never mints an id — it reads
	 * one off the rollout on disk and carries on with it. So the rollout is
	 * written here, before codex has run, with the row's own id in its first
	 * line, and the terminal's first command is a resume of a session that has
	 * one line of history. Codex accepts it, appends to it, and answers
	 * `thread.started` with the id it was handed — verified on 0.150.1, headless
	 * and interactive both, with the model flag honoured on the way in.
	 *
	 * The id is the row's, exactly as with claude, which is what makes `resume`
	 * on both sides of the socket a fixed argv again rather than a lookup.
	 *
	 * It is a workaround with an expiry date, and the date is the same one the
	 * old workaround had:
	 *
	 *   openai/codex#7801 — "Allows specifying a SessionID for better embedding
	 *   of automated workflows"
	 *   https://github.com/openai/codex/issues/7801
	 *
	 * If `--session` lands, `reserve` below becomes a flag and this comment
	 * becomes history. Until then it leans on the rollout's first line being
	 * what codex reads, which is undocumented and has been stable across the
	 * versions we have seen; the fields written are the ones a real session
	 * writes, minus the ones codex fills in for itself.
	 */
	open: (spec: SessionSpec): Effect.Effect<Launch, ProviderError> =>
		Effect.tryPromise({
			try: () => reserve(spec),
			catch: (cause) =>
				new ProviderError({
					provider: "codex",
					reason: cause instanceof Error ? cause.message : String(cause),
					cause,
				}),
		}),

	/*
	 * No hook argument, and its absence is the point.
	 *
	 * This used to end `...codexHookArgs()` — `-c hooks.Stop=…`, the same door
	 * the reasoning effort goes through. It worked, intermittently, which is the
	 * worst way for it to work: the same session would report one turn and stay
	 * dark on the next, and an attention light you cannot trust is worse than no
	 * light at all, because you start checking the dark rows by hand.
	 *
	 * So the hook moved to `~/.codex/config.toml`, where it is not an override
	 * on one invocation but simply what codex does. `install.sh` writes it and
	 * `codexHookConfig()` is what it writes; nothing is passed from here. See
	 * `hooks.ts`.
	 *
	 * No model or effort either, and that is not an oversight: a resumed session
	 * takes both from the transcript it resumes. They go on the *opening* resume
	 * only — see `reserve` — where the transcript is one line long and has
	 * nothing to say about either.
	 */
	resume: (externalId: string): string[] => [BINARY, "resume", externalId],

	/*
	 * Nothing to wait for. This was two seconds while `exec` opened sessions —
	 * it exited before the rollout it wrote was readable, and a `resume` fired
	 * the instant the daemon answered raced the write and lost. The rollout is
	 * now ours, written and synced before `open` returns, so the race has no
	 * other runner.
	 */
	attachDelayMs: 0,

	locate: (
		externalId: string,
	): Effect.Effect<FoundSession | null, ProviderError> =>
		Effect.tryPromise({
			try: () => findRollout(externalId),
			catch: (cause) =>
				new ProviderError({
					provider: "codex",
					reason: cause instanceof Error ? cause.message : String(cause),
					cause,
				}),
		}),
};

/**
 * The rollout with this id, found by reading what codex wrote.
 *
 * Codex records every session as a rollout under
 * `~/.codex/sessions/YYYY/MM/DD/rollout-<stamp>-<uuid>.jsonl`, and its first
 * line is a `session_meta` naming the session and the directory it ran in. So
 * this is a full pass — every rollout's first line, once, until one names the
 * session asked for. The id is in the filename too, but a name is a convention
 * and the line is the record, and this is not a hot path: it runs when
 * somebody pastes an id.
 */
async function findRollout(id: string): Promise<FoundSession | null> {
	const root = join(codexHome(), "sessions");

	let names: string[];
	try {
		names = await readdir(root, { recursive: true });
	} catch {
		// no sessions directory at all: codex has never run here
		return null;
	}

	for (const name of names) {
		if (!name.endsWith(".jsonl")) continue;

		const path = join(root, name);
		const meta = await firstLine(path);
		if (meta?.type !== "session_meta") continue;
		if (meta.payload?.session_id !== id) continue;

		const cwd = meta.payload?.cwd;
		// a rollout that does not say where it ran cannot be resumed in the right
		// place, and resuming in the wrong one finds nothing
		if (typeof cwd !== "string" || !cwd) return null;

		return { externalId: id, cwd, title: await opening(path) };
	}

	return null;
}

/**
 * How far into a rollout to look for the first thing a person said.
 *
 * Codex leads with a `session_meta` and then whatever context it was given,
 * which can be long; the opening turn is behind that and nowhere near the end.
 */
const OPENING_BYTES = 128 * 1024;

/**
 * The first message in a rollout, for something to call the row.
 *
 * Deliberately forgiving about shape. Codex has spelled a user turn more than
 * one way across versions — a `user_message` event with the text on it, a
 * `response_item` holding a message with content blocks — and a title is not
 * worth failing an import over. Null when none of the shapes match, and the
 * caller falls back to the id.
 */
async function opening(path: string): Promise<string | null> {
	let head: string;
	try {
		head = await Bun.file(path).slice(0, OPENING_BYTES).text();
	} catch {
		return null;
	}

	for (const line of head.split("\n")) {
		if (!line) continue;

		let record: Rollout;
		try {
			record = JSON.parse(line) as Rollout;
		} catch {
			// the byte limit above truncates the last line of every long rollout
			continue;
		}

		const payload = record.payload;
		if (!payload) continue;

		if (typeof payload.message === "string" && payload.message.trim()) {
			return payload.message.trim();
		}

		if (payload.role !== "user") continue;

		const text = said(payload.content);
		if (text) return text;
	}

	return null;
}

interface Rollout {
	payload?: {
		role?: string;
		message?: unknown;
		content?: unknown;
	};
}

/**
 * The text out of a content list, which codex writes as blocks. Any block
 * carrying a `text` counts — the block type has been spelled `input_text` and
 * `text` in different versions, and matching on the name is the part that keeps
 * breaking. A block with no text in it is not a sentence and is skipped.
 */
const said = (content: unknown): string | null => {
	if (typeof content === "string") return content.trim() || null;
	if (!Array.isArray(content)) return null;

	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const text = (block as { text?: unknown }).text;
		if (typeof text === "string" && text.trim()) return text.trim();
	}

	return null;
};

/**
 * Writes the session down and says how to open it.
 *
 * The rollout is one line: a `session_meta` naming the id, the directory and
 * the moment, filed where codex files its own —
 * `<home>/sessions/YYYY/MM/DD/rollout-<stamp>-<id>.jsonl`, local time in the
 * name as codex uses. Codex finds it by id (its index first, then a scan of
 * the files, so an unindexed file is enough), reads the id off the first line
 * and appends from there; the line itself is left exactly as written.
 *
 * `wx` rather than a plain write, and `0600` because that is what codex
 * gives its own: an id that already has a rollout is somebody's session, and
 * this must refuse to write over it rather than quietly claim it. A fresh
 * UUIDv7 will never collide, so refusing costs nothing — but the promise
 * should be in the flags, not in the argument.
 *
 * Synced before returning, because the terminal is spawned the moment this
 * answers and the first thing it runs is a read of this file.
 *
 * The model and the effort ride on this resume and no other. There is no
 * transcript for them to be inherited from yet, so this is the run that sets
 * them, and every later `resume` inherits from what this one wrote.
 */
async function reserve(spec: SessionSpec): Promise<Launch> {
	const now = new Date();
	const dir = join(codexHome(), "sessions", ...datePath(now));
	await mkdir(dir, { recursive: true });

	const path = join(dir, `rollout-${stamp(now)}-${spec.id}.jsonl`);
	const at = now.toISOString();
	const meta = {
		timestamp: at,
		ordinal: 0,
		type: "session_meta",
		payload: {
			// both spellings, because codex writes both and reads one of them —
			// which one has changed across versions and is not worth betting on
			session_id: spec.id,
			id: spec.id,
			timestamp: at,
			cwd: spec.cwd,
			// what an interactive session says about itself, which is what this
			// is about to be
			originator: "codex-tui",
			cli_version: await version(),
			source: "cli",
			thread_source: "user",
			model_provider: "openai",
		},
	};

	const file = await openFile(path, "wx", 0o600);
	try {
		await file.writeFile(`${JSON.stringify(meta)}\n`);
		await file.sync();
	} finally {
		await file.close();
	}

	return {
		externalId: spec.id,
		argv: [
			BINARY,
			"resume",
			spec.id,
			...runFlags(spec),
			// last, and unflagged: `resume` reads a bare argument as the prompt to
			// send once the session is open
			spec.prompt,
		],
	};
}

/** `YYYY/MM/DD` as three segments, in local time, which is where codex files things. */
const datePath = (at: Date): [string, string, string] => [
	String(at.getFullYear()),
	String(at.getMonth() + 1).padStart(2, "0"),
	String(at.getDate()).padStart(2, "0"),
];

/**
 * `YYYY-MM-DDThh-mm-ss`, local time: the moment in the filename, with the
 * colons codex cannot put in a name turned into dashes.
 */
const stamp = (at: Date): string => {
	const [year, month, day] = datePath(at);
	const clock = [at.getHours(), at.getMinutes(), at.getSeconds()]
		.map((part) => String(part).padStart(2, "0"))
		.join("-");
	return `${year}-${month}-${day}T${clock}`;
};

/**
 * How long `codex --version` gets. It is one process printing one line, so
 * anything past this is a codex that is not going to answer anything.
 */
const VERSION_LIMIT_MS = 10_000;

/** The one answer, kept: the CLI does not change under a running daemon. */
let cliVersion: Promise<string> | null = null;

/**
 * What `codex --version` says, as the number a rollout records — `0.150.1`
 * out of `codex-cli 0.150.1`.
 *
 * Asked once and kept for the life of the daemon, because it is a process
 * spawn on the path of every open and the answer does not change. A failure
 * is not kept: a codex that could not be run once may be installed by the
 * next attempt, and remembering "no" would make that attempt fail for a
 * reason that is no longer true.
 */
const version = (): Promise<string> => {
	if (!cliVersion) {
		cliVersion = askVersion().catch((cause) => {
			cliVersion = null;
			throw cause;
		});
	}
	return cliVersion;
};

async function askVersion(): Promise<string> {
	const child = Bun.spawn([BINARY, "--version"], {
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
	});

	try {
		const said = await Promise.race([
			new Response(child.stdout).text(),
			expire(VERSION_LIMIT_MS, "codex"),
		]);

		const number = said.match(/\d+\.\d+\.\d+\S*/)?.[0];
		if (number) return number;

		throw new Error(sentence(await new Response(child.stderr).text()));
	} finally {
		child.kill();
	}
}

/** Where codex keeps its transcripts. `CODEX_HOME` moves the whole directory. */
const codexHome = (): string =>
	process.env.CODEX_HOME ?? join(homedir(), ".codex");

interface SessionMeta {
	type?: string;
	payload?: { session_id?: string; cwd?: string };
}

/** Only the first line is wanted, and a rollout grows without bound. */
async function firstLine(path: string): Promise<SessionMeta | null> {
	try {
		const head = await Bun.file(path)
			.slice(0, 64 * 1024)
			.text();
		const line = head.split("\n")[0];
		return line ? (JSON.parse(line) as SessionMeta) : null;
	} catch {
		return null;
	}
}

const BINARY = "codex";

/**
 * Model and effort, which codex spells in two different ways.
 *
 * The model has a flag of its own. The effort does not exist as one at all —
 * it is reachable only as a config override, parsed as TOML, which is why the
 * value is quoted and the model's is not.
 *
 * These belong to a run that is *starting*. A resumed session inherits both
 * from the one it resumes and will not take them again, so nothing below sends
 * them twice.
 */
const runFlags = (spec: SessionSpec): string[] => [
	...(spec.model ? ["-m", spec.model] : []),
	...(spec.variant ? ["-c", `model_reasoning_effort="${spec.variant}"`] : []),
	// The `Stop` hook was a third `-c` here and is not any more — it lives in
	// codex's own config now, for the reason written above `resume`. Nothing is
	// lost on this particular run either way: `exec` is headless and finishes
	// before there is a row to light.
];

/** The server first; the file when the server fails. See the adapter. */
async function listCodexModels(): Promise<Model[]> {
	try {
		return await askCodex();
	} catch (cause) {
		return (await readModelsCache()) ?? Promise.reject(cause);
	}
}

/** Where codex keeps the list it was last given, under its home. */
const MODELS_CACHE = "models_cache.json";

/**
 * The list as codex would present it, out of the file — or null when there is
 * no usable file, which hands the server's own failure back to the caller.
 *
 * Null rather than an empty list on every failure, on purpose: a file that is
 * missing, half-written, or from a version that spells things differently all
 * mean "cannot say", and an empty picker would say "no models", which is a
 * different and false thing.
 *
 * Only the rows codex would list. `hide` is what the server drops too — the
 * internal `gpt-reserve` and `codex-auto-review` rows are in the file and in
 * no picker. `priority` is the server's order, and its `isDefault` is the
 * lowest one, verified against a live answer.
 */
async function readModelsCache(): Promise<Model[] | null> {
	let file: CachedModels;
	try {
		file = (await Bun.file(
			join(codexHome(), MODELS_CACHE),
		).json()) as CachedModels;
	} catch {
		return null;
	}

	const listed = (file.models ?? [])
		.filter(
			(model) => typeof model.slug === "string" && model.visibility === "list",
		)
		.sort((a, b) => rank(a) - rank(b));

	if (listed.length === 0) return null;

	return listed.map((model, index) => ({
		id: model.slug,
		label: model.display_name ?? model.slug,
		description: model.description ?? "",
		variants: (model.supported_reasoning_levels ?? [])
			.filter((level) => typeof level.effort === "string")
			.map((level) => ({
				id: level.effort,
				label: level.effort,
				description: level.description ?? "",
			})),
		defaultVariant: model.default_reasoning_level ?? null,
		recommended: index === 0,
	}));
}

/** A row with no priority sorts last, which is where an unranked thing goes. */
const rank = (model: CachedModel): number =>
	typeof model.priority === "number"
		? model.priority
		: Number.POSITIVE_INFINITY;

interface CachedModels {
	models?: CachedModel[];
}

interface CachedModel {
	slug: string;
	display_name?: string;
	description?: string;
	visibility?: string;
	priority?: number;
	default_reasoning_level?: string;
	supported_reasoning_levels?: { effort: string; description?: string }[];
}

/**
 * `--stdio` is spelled out because the transport is not the default everywhere,
 * and a version that does not know the flag rejects it loudly — which is a
 * better failure than one that silently waits on a socket nobody opened.
 */
const COMMAND = ["codex", "app-server", "--stdio"];

/** Long enough for a cold start, short enough that a hung CLI is not forever. */
const TIMEOUT_MS = 10_000;

/** The id we put on the question, so its answer is the one we pick up. */
const LIST_ID = 1;

const HANDSHAKE = [
	{
		method: "initialize",
		id: 0,
		params: { clientInfo: { name: "magents", version: "0" } },
	},
	{ method: "initialized" },
	{ method: "model/list", id: LIST_ID, params: {} },
];

async function askCodex(): Promise<Model[]> {
	const child = Bun.spawn(COMMAND, {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});

	try {
		for (const message of HANDSHAKE) {
			child.stdin.write(`${JSON.stringify(message)}\n`);
		}
		await child.stdin.flush();

		// stdin stays open on purpose: closing it is how the server is told the
		// session is over, and it exits before answering.
		const answer = await Promise.race([
			reply(child.stdout),
			expire(TIMEOUT_MS, "codex"),
		]);

		if (!answer) {
			// stdout ended with nothing for us, which is what a CLI that failed to
			// start looks like from here. Its complaint went to stderr.
			throw new Error(
				explained(sentence(await new Response(child.stderr).text())),
			);
		}

		return answer;
	} finally {
		// runs on the timeout and on the throw above, not only on the happy path —
		// a spawned app-server nobody killed outlives the request that wanted it
		child.kill();
	}
}

/**
 * Codex's one unhelpful sentence, with what it means put after it.
 *
 * "failed to initialize sqlite state runtime" is every SQLite failure codex
 * has, said the same way: another process holding `logs_2.sqlite` past the
 * five-second lock timeout, a `~/.codex` the daemon cannot write to, two
 * codex builds sharing one home. All three were reproduced and all three
 * print this. The person reading it is looking at a spawn panel, and the one
 * command that tells the cases apart is worth more than the sentence.
 */
const explained = (reason: string): string =>
	/sqlite state runtime/.test(reason)
		? `${reason} — another codex is holding ~/.codex/logs_2.sqlite, or ~/.codex is not writable: try \`lsof ~/.codex/logs_2.sqlite\``
		: reason;

/**
 * The one line of a CLI's dying words worth repeating.
 *
 * A node process that cannot start prints a stack trace, and the sentence
 * buried in it — "Missing optional dependency @openai/codex-linux-x64" — is
 * the only part that tells anyone what to do; the frames under it are about
 * node's module loader. The screen has one line for this, so it gets the
 * sentence rather than the first line, which is a file path.
 */
const sentence = (stderr: string): string => {
	const lines = stderr
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

	const named = lines.find((line) => line.startsWith("Error:"));

	return (
		named?.slice("Error:".length).trim() ??
		lines[0] ??
		"codex exited without answering"
	);
};

/** Reads until the answer to `LIST_ID` goes by, or the stream runs out. */
async function reply(
	stdout: ReadableStream<Uint8Array>,
): Promise<Model[] | null> {
	for await (const line of lines(stdout)) {
		const message = parse(line);
		if (!message || message.id !== LIST_ID) continue;

		const data = (message as CodexReply).result?.data ?? [];
		return data.filter((model) => !model.hidden).map(toModel);
	}

	return null;
}

/**
 * The stream arrives in chunks, not messages: one read can hold half a line or
 * three of them, and a JSON parse of either is a failure that looks like bad
 * data rather than a buffer that was not finished.
 */
async function* lines(
	stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
	const decoder = new TextDecoder();
	let buffer = "";

	for await (const chunk of stream) {
		buffer += decoder.decode(chunk, { stream: true });

		let end = buffer.indexOf("\n");
		while (end !== -1) {
			yield buffer.slice(0, end);
			buffer = buffer.slice(end + 1);
			end = buffer.indexOf("\n");
		}
	}

	if (buffer.trim()) yield buffer;
}

/** Anything unparseable is a line meant for someone else, not an error. */
const parse = (line: string): { id?: number } | null => {
	try {
		return JSON.parse(line) as { id?: number };
	} catch {
		return null;
	}
};

interface CodexReply {
	result?: { data?: CodexModel[] };
}

interface CodexModel {
	id: string;
	displayName?: string;
	description?: string;
	hidden?: boolean;
	isDefault?: boolean;
	defaultReasoningEffort?: string;
	supportedReasoningEfforts?: {
		reasoningEffort: string;
		description: string;
	}[];
}

const toModel = (model: CodexModel): Model => ({
	id: model.id,
	label: model.displayName ?? model.id,
	description: model.description ?? "",
	variants: (model.supportedReasoningEfforts ?? []).map((variant) => ({
		id: variant.reasoningEffort,
		label: variant.reasoningEffort,
		description: variant.description,
	})),
	defaultVariant: model.defaultReasoningEffort ?? null,
	recommended: model.isDefault === true,
});
