import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type ModelInfo, query } from "@anthropic-ai/claude-agent-sdk";
import { Effect } from "effect";
import { ProviderError } from "../errors/provider-error";
import { expire } from "../lib/expire";
import { claudeHookArgs } from "./hooks";
import type { Model } from "./model";
import type { ProviderAdapter } from "./provider-adapter";
import type { FoundSession, Launch, SessionSpec } from "./session-spec";

/**
 * Claude, asked through the agent SDK.
 *
 * Cheaper to reach than codex — the SDK owns the transport, so there is no
 * server to start or JSON-RPC to speak. What it costs instead is a session: the
 * list hangs off a `query`, and a query wants a prompt. It gets one that never
 * produces anything, and is closed the moment the answer is in hand.
 */
export const claudeAdapter: ProviderAdapter = {
	id: "claude",
	listModels: Effect.tryPromise({
		try: askClaude,
		catch: (cause) =>
			new ProviderError({
				provider: "claude",
				reason: cause instanceof Error ? cause.message : String(cause),
				cause,
			}),
	}),

	/*
	 * Nothing to run and nothing to discover: `--session-id` takes a UUID and
	 * makes it the conversation's own, so the row's id is already the handle.
	 * The session does not exist yet when this returns — it comes into being
	 * when the terminal runs the command, which is exactly what we want, because
	 * a session minted here and never attached to would be a ghost.
	 */
	open: (spec: SessionSpec): Effect.Effect<Launch> =>
		Effect.succeed({
			externalId: spec.id,
			argv: [
				BINARY,
				"--session-id",
				spec.id,
				...claudeHookArgs(),
				...(spec.model ? ["--model", spec.model] : []),
				...(spec.variant ? ["--effort", spec.variant] : []),
				// last, and unflagged: claude reads a bare argument as the first
				// thing it is being asked
				spec.prompt,
			],
		}),

	// the hooks go on every run, not just the first: a resumed session is the one
	// most likely to be left alone in the background, which is where being told
	// it finished is worth the most
	resume: (externalId: string): string[] => [
		BINARY,
		"--resume",
		externalId,
		...claudeHookArgs(),
	],

	/*
	 * Claude's own agent view is turned off, for both the run that opens a
	 * session and every resume after it.
	 *
	 * It is a second screen claude can put itself into — left arrow from the
	 * prompt sends the session to the background and `claude agents` lists them
	 * — and it assumes it is the only thing in the terminal. Inside one of our
	 * panes it is not: the session it would background is one the daemon is
	 * holding a PTY on and the roster has a row for, so backgrounding it there
	 * hides a session from the one list that is supposed to know about all of
	 * them. Reaching for the left arrow while editing a line is how somebody
	 * finds that out.
	 *
	 * The environment variable rather than `--settings '{"disableAgentView":
	 * true}'`: the flag would have to be threaded into both `open` and `resume`
	 * and would take the place of whatever settings the user passes claude
	 * themselves, which is theirs and not ours to replace.
	 */
	env: { CLAUDE_CODE_DISABLE_AGENT_VIEW: "1" },

	// nothing to wait for: the session is created by the command the terminal
	// runs, so it is ready exactly when the terminal is
	attachDelayMs: 0,

	locate: (
		externalId: string,
	): Effect.Effect<FoundSession | null, ProviderError> =>
		Effect.tryPromise({
			try: () => findTranscript(externalId),
			catch: (cause) =>
				new ProviderError({
					provider: "claude",
					reason: cause instanceof Error ? cause.message : String(cause),
					cause,
				}),
		}),

	fork: (
		externalId: string,
		cwd: string,
	): Effect.Effect<string, ProviderError> =>
		Effect.tryPromise({
			try: () => forkSession(externalId, cwd),
			catch: (cause) =>
				new ProviderError({
					provider: "claude",
					reason: cause instanceof Error ? cause.message : String(cause),
					cause,
				}),
		}),
};

/**
 * A turn has to be sent, and this is one that asks for nothing.
 *
 * `--fork-session` does not copy a conversation on its own — it forks the one
 * the run resumes, so there has to be a run, and a run has to have a prompt.
 * Which makes the wording load-bearing rather than a placeholder: the model
 * arrives holding the entire history of somebody else's work, and "ok" is an
 * invitation to carry on with it. This says there is no task and names itself,
 * so a person reading the transcript later can see what the first line was for.
 */
const PING =
	"[SESSION_PING] No task. Do not take any action or continue prior work.";

/**
 * Long enough for a real turn, because that is what this is.
 *
 * Not the ten seconds `listModels` gets. Forking loads the whole conversation
 * as context before it answers, so the wait grows with the session being
 * imported; this is a guard against a hang rather than a deadline anyone should
 * hit.
 */
const FORK_LIMIT_MS = 2 * 60 * 1_000;

/**
 * Copies a conversation into one of our own and hands back its id.
 *
 * `-p` for a headless run, `--output-format json` so the answer is a record
 * rather than a screen, and `session_id` off that record is the fork. Run in
 * the directory the original ran in, because that is where claude keeps it and
 * a fork started anywhere else would have nothing to fork.
 */
async function forkSession(externalId: string, cwd: string): Promise<string> {
	const child = Bun.spawn(
		[
			BINARY,
			"-p",
			"--resume",
			externalId,
			"--fork-session",
			"--output-format",
			"json",
			PING,
		],
		{ cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore" },
	);

	try {
		const answer = await Promise.race([
			new Response(child.stdout).text(),
			expire(FORK_LIMIT_MS, "claude"),
		]);

		const id = sessionId(answer);
		if (id) return id;

		// stdout held nothing we could use, which is what a refused resume looks
		// like from here — the complaint went to stderr
		throw new Error(refusal(await new Response(child.stderr).text(), answer));
	} finally {
		// a no-op once it has exited on its own; it matters on the timeout
		child.kill();
	}
}

/**
 * The forked session's id, out of whatever `--output-format json` printed.
 *
 * Tolerant about the envelope on purpose. The flag has answered with a single
 * object and with a stream of them across versions, so every line is tried and
 * the first `session_id` wins, rather than the shape being asserted once and
 * breaking on the next release.
 */
const sessionId = (stdout: string): string | null => {
	for (const line of [stdout, ...stdout.split("\n")]) {
		if (!line.trim()) continue;

		try {
			const parsed = JSON.parse(line) as { session_id?: unknown };
			if (typeof parsed.session_id === "string" && parsed.session_id) {
				return parsed.session_id;
			}
		} catch {
			// not this line
		}
	}

	return null;
};

/**
 * Why the fork did not happen, in claude's words where there are any.
 *
 * stderr first, because a refusal is written there. When it is empty the run
 * printed something on stdout that had no id in it, and the head of that is
 * more use than a sentence we invented.
 */
const refusal = (stderr: string, stdout: string): string => {
	const said = stderr.trim() || stdout.trim();

	if (!said) return "claude forked nothing and said nothing";

	const first = said.split("\n").find((line) => line.trim());

	return first?.trim() ?? said.slice(0, 200);
};

/** Where claude keeps its transcripts. `CLAUDE_CONFIG_DIR` moves the whole lot. */
const claudeHome = (): string =>
	process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");

/**
 * How much of a transcript to read looking for the two things wanted from it.
 *
 * Generous, because the answer is not always near the top: claude writes an
 * attachment record listing every tool it was given, and one of those alone can
 * run to tens of kilobytes before the first thing a person said. Bounded all the
 * same, because a transcript grows without limit and none of what is wanted here
 * is ever at the end.
 */
const HEAD_BYTES = 256 * 1024;

/**
 * The session with this id, found by reading what claude wrote.
 *
 * Claude files every conversation as `<home>/projects/<mangled cwd>/<id>.jsonl`,
 * where the folder is the working directory with its slashes turned into dashes.
 * That mangling is lossy — a directory whose name contains a dash produces the
 * same folder as one with a slash in that position — so it is used only to find
 * the file, and the `cwd` that comes back is read out of a record inside it.
 *
 * One `readdir` and then one open per project folder, rather than a recursive
 * walk: the id is the filename, so the only question per folder is whether the
 * file is in it.
 */
async function findTranscript(id: string): Promise<FoundSession | null> {
	const root = join(claudeHome(), "projects");

	let folders: string[];
	try {
		folders = await readdir(root);
	} catch {
		// no projects directory at all: claude has never run for this user
		return null;
	}

	for (const folder of folders) {
		const found = await readTranscript(join(root, folder, `${id}.jsonl`), id);
		if (found) return found;
	}

	return null;
}

interface Line {
	type?: string;
	aiTitle?: string;
	cwd?: string;
	message?: { content?: unknown };
}

/**
 * The directory and the name of a conversation, from the head of its file.
 *
 * Two candidates for the name, and the order is the point. `ai-title` is
 * claude's own summary of what the conversation turned out to be about and it
 * is usually the better line — the first thing said is often "continue", which
 * titles a row with nothing. The first message is the fallback, because it is
 * always there and a summary is not.
 *
 * Reading stops as soon as both are in hand, which for most transcripts is the
 * fourth line.
 */
async function readTranscript(
	path: string,
	id: string,
): Promise<FoundSession | null> {
	let head: string;
	try {
		head = await Bun.file(path).slice(0, HEAD_BYTES).text();
	} catch {
		// not this project's folder, which is the expected answer for all but one
		return null;
	}

	let cwd: string | null = null;
	let summary: string | null = null;
	let first: string | null = null;

	for (const line of head.split("\n")) {
		if (!line) continue;

		let record: Line;
		try {
			record = JSON.parse(line) as Line;
		} catch {
			// a truncated last line is what the byte limit above produces, every
			// time, on any transcript longer than it
			continue;
		}

		if (!cwd && typeof record.cwd === "string") cwd = record.cwd;
		if (!summary && record.type === "ai-title" && record.aiTitle) {
			summary = record.aiTitle;
		}
		if (!first && record.type === "user") first = said(record.message?.content);

		if (cwd && summary) break;
	}

	// A transcript with no `cwd` anywhere in its head is one we cannot resume in
	// the right place, and resuming in the wrong place finds nothing. Better to
	// report the id as not found than to file it under a directory it never ran
	// in.
	if (!cwd) return null;

	return { externalId: id, cwd, title: summary ?? first };
}

/**
 * What a person actually typed, out of a message that may be either a string or
 * a list of blocks. Anything else — a tool result, an image — is not a sentence
 * and is not a title.
 */
const said = (content: unknown): string | null => {
	if (typeof content === "string") return content.trim() || null;
	if (!Array.isArray(content)) return null;

	for (const block of content) {
		if (typeof block === "string" && block.trim()) return block.trim();
		if (
			block &&
			typeof block === "object" &&
			(block as { type?: string }).type === "text"
		) {
			const text = (block as { text?: unknown }).text;
			if (typeof text === "string" && text.trim()) return text.trim();
		}
	}

	return null;
};

const BINARY = "claude";

/** Long enough for a cold start, short enough that a hung CLI is not forever. */
const TIMEOUT_MS = 10_000;

/** The entry that is a pointer to another entry rather than a model of its own. */
const ALIAS = "default";

/**
 * What to start on when the provider will not say.
 *
 * Unlike codex, `ModelInfo` names no default effort — and something has to be
 * selected, because a model running on an unstated level is a setting nobody
 * can see. This is our choice, not claude's: `medium` is the middle of every
 * list it offers and the level codex's own defaults land on almost everywhere,
 * which makes it the least surprising place to be put down.
 */
const ASSUMED_VARIANT = "medium";

/**
 * A prompt that never says anything.
 *
 * `query` is built to run a conversation and this one has no turn to take — it
 * exists so the session comes up at all. Yielding nothing rather than closing
 * keeps the session open long enough to be asked.
 */
async function* silent(): AsyncGenerator<never> {
	await new Promise(() => {});
}

/**
 * Where the CLI is, told to the SDK rather than left to it.
 *
 * Left to itself the SDK resolves a binary shipped in its own package, relative
 * to `import.meta.url`. That works when the daemon runs from source and fails
 * outright once it is a compiled one: `bun build --compile` embeds JavaScript
 * and nothing else, `import.meta.url` becomes a path inside `/$bunfs`, and
 * every request for the model list comes back as
 * `Native CLI binary for linux-x64 not found`. The daemon looked healthy and
 * one route was dead.
 *
 * `Bun.which` and not a bundled copy, because there is already an answer to
 * "which claude": the one on PATH is what `open` and `resume` spawn, so asking
 * the SDK to use a different one would be two claudes in a program whose whole
 * job is to be sure which conversation it is talking to.
 *
 * `undefined` when it is not on PATH, which hands the question back to the SDK.
 * Its own error is the better sentence at that point — a daemon that cannot
 * find claude at all has a bigger problem than this route.
 */
const executable = (): string | undefined => Bun.which(BINARY) ?? undefined;

async function askClaude(): Promise<Model[]> {
	const session = query({
		prompt: silent(),
		options: { pathToClaudeCodeExecutable: executable() },
	});

	try {
		const models = await Promise.race([
			session.supportedModels(),
			expire(TIMEOUT_MS, "claude"),
		]);

		/*
		 * `default` is not a model, it is a second name for one — its
		 * `resolvedModel` is the same `claude-opus-5[1m]` that `opus[1m]` already
		 * offers under its own name. Listing both puts the same thing in the
		 * picker twice, and asks the reader to work out that "Default
		 * (recommended)" and "Opus (1M context)" are one choice.
		 *
		 * Dropped, but not before it is read: which model it points at is the one
		 * piece of information only this entry carries, and it is exactly what
		 * `recommended` wants to know.
		 */
		const alias = models.find((model) => model.value === ALIAS);
		const preferred = alias?.resolvedModel;

		return models
			.filter((model) => model.value !== ALIAS)
			.map((model) => toModel(model, preferred));
	} finally {
		// on the timeout as readily as on the answer: a session nobody closed is a
		// CLI still running for a request that has already been given up on
		session.close();
	}
}

const toModel = (model: ModelInfo, preferred: string | undefined): Model => {
	const levels = model.supportedEffortLevels ?? [];

	return {
		id: model.value,
		label: model.displayName,
		description: model.description,
		variants: levels.map((level) => ({
			id: level,
			label: level,
			// the SDK names the levels but never explains them, unlike codex. An
			// empty string is the honest answer; inventing a sentence per level
			// here would put words in the provider's mouth.
			description: "",
		})),
		defaultVariant: levels.includes(ASSUMED_VARIANT)
			? ASSUMED_VARIANT
			: (levels[0] ?? null),
		// the model the dropped `default` entry resolved to, wearing its own name
		recommended: preferred !== undefined && model.resolvedModel === preferred,
	};
};
