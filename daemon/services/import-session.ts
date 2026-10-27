import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { sessions } from "../db/schema";
import { DatabaseError } from "../errors/database-error";
import type { ProviderError } from "../errors/provider-error";
import { UnknownSessionError } from "../errors/unknown-session-error";
import { sessionTitle } from "../lib/session-title";
import { adapters } from "../providers/adapters";
import type { ProviderId } from "../providers/provider-id";
import type { FoundSession } from "../providers/session-spec";
import { createProject } from "./create-project";
import { Database } from "./database";
import { startTerminal } from "./start-terminal";
import { type LiveSession, Terminals } from "./terminals";

/** A session that was already out there, and now has a row. */
export interface ImportedSession {
	session: LiveSession;
	/**
	 * Whether the row is new. False when the handle was already in the roster,
	 * which is a success and not a duplicate — but it is not a creation either,
	 * and the route answers with a different code for each.
	 */
	created: boolean;
}

/**
 * Takes a conversation somebody started outside magents and gives it a row.
 *
 * The opposite of `openSession` in every step and the same in shape. That one
 * mints a handle and makes a conversation exist; this one is handed a handle
 * and goes looking for a conversation that already does. What it finds is the
 * part a handle cannot carry: the directory the session ran in, which is what
 * `resume` needs and is not ours to guess.
 *
 * Nobody says which provider. Both are asked, and the one holding the
 * conversation answers — the id is a UUID either way, so a picker would be
 * asking the user for something the filesystem already knows, and getting it
 * wrong would look exactly like the id being wrong.
 *
 * Idempotent on the handle it stores, which for claude is the fork's and not
 * the one that was pasted. So importing a codex id twice finds the row that is
 * already there, and importing a claude id twice forks again — correctly, if
 * unexpectedly: each fork is its own conversation from the moment it is made,
 * and the id that was typed stops being ours the moment the fork exists.
 */
export const importSession = (
	externalId: string,
	/**
	 * What to call it. The screen always sends one, because a name you chose
	 * beats a name guessed off the first line of somebody else's conversation —
	 * and for a fork the first line is the ping that made it. Optional here all
	 * the same, so that a caller with nothing to offer still gets a usable row
	 * rather than a refusal.
	 */
	title?: string,
): Effect.Effect<
	ImportedSession,
	UnknownSessionError | DatabaseError | ProviderError,
	Database | Terminals
> =>
	Effect.gen(function* () {
		const { db } = yield* Database;
		const terminals = yield* Terminals;

		const existing = yield* Effect.try({
			try: () =>
				db
					.select()
					.from(sessions)
					.where(eq(sessions.externalId, externalId))
					.get(),
			catch: (cause) =>
				new DatabaseError({ operation: "importSession/existing", cause }),
		});

		if (existing) {
			return { session: terminals.overlay(existing), created: false };
		}

		const hit = yield* search(externalId);

		if (Option.isNone(hit)) {
			return yield* new UnknownSessionError({
				externalId,
				reason: `no claude or codex session with that id`,
			});
		}

		const [provider, found] = hit.value;

		// Registered rather than looked up, and that is the whole difference
		// between this working and this being a two-step. The folder a session ran
		// in is a project whether magents knows it or not, and `createProject` is
		// idempotent, so a known path comes back as the row it already was.
		const project = yield* createProject(found.cwd);

		/*
		 * Forked before it is written down, where the provider asks for it — which
		 * today is claude and only claude.
		 *
		 * The conversation being imported may still be attached to something; a
		 * `claude --bg` run leaves one going, and claude refuses a second resume
		 * rather than let two writers race over one transcript. So it is copied
		 * instead: the fork carries the history, has an id nobody else holds, and
		 * leaves the original running for whoever is already in it.
		 *
		 * The fork's handle is the only one kept. The one that was pasted got us
		 * here and then stopped being ours — it names a conversation somebody else
		 * may still be sitting in, and a row holding it would be a row claiming
		 * something it deliberately did not take.
		 */
		const adapter = adapters[provider];
		const forked = adapter?.fork
			? yield* adapter.fork(found.externalId, found.cwd)
			: null;

		const row = yield* Effect.try({
			try: () =>
				db
					.insert(sessions)
					.values({
						projectId: project.id,
						provider,
						externalId: forked ?? found.externalId,
						// What was asked for, and failing that the original's — never the
						// fork's. A fork's own first line is the ping that had to be sent
						// to make one, and a roster full of `[SESSION_PING]` says nothing.
						title: named(title, found),
						// Left blank on purpose. A resumed session inherits both from the
						// conversation it resumes and will not take them again, so the only
						// honest thing to store is that we were not the ones who chose.
						model: null,
						variant: null,
						// the same as a fresh one: it has just arrived in a roster and
						// nobody has looked at it yet
						requiresAttention: true,
					})
					.returning()
					.get(),
			catch: (cause) =>
				new DatabaseError({ operation: "importSession", cause }),
		});

		/*
		 * Started here, so that importing is one step rather than a row you then
		 * have to press a key on. The same call `⌃r` makes, which is deliberate:
		 * there is no second way to spawn, and a resume is a resume whoever asked
		 * for it.
		 *
		 * A refusal does not fail the import, for the reason `openSession` gives
		 * about its own spawn: the row is written and the conversation is real, so
		 * answering "could not import" would be the wrong sentence about it. What
		 * the CLI said is in the session's history and on its next frame, which is
		 * where the pane is looking anyway.
		 */
		const started = yield* startTerminal(row.id).pipe(
			Effect.catchAll(() => Effect.succeed(Option.none<LiveSession>())),
		);

		return {
			session: Option.getOrElse(started, () => terminals.overlay(row)),
			created: true,
		};
	});

/**
 * Every provider, in turn, until one recognises the handle.
 *
 * A provider that cannot be asked at all is not allowed to end the search. Its
 * store may be missing because it has never run on this machine, and one
 * uninstalled CLI must not be the reason the other one's session cannot be
 * imported — so the failure is kept and only raised if nobody else says yes.
 */
const search = (
	externalId: string,
): Effect.Effect<
	Option.Option<[ProviderId, FoundSession]>,
	ProviderError,
	never
> =>
	Effect.gen(function* () {
		let refusal: ProviderError | null = null;

		for (const [id, adapter] of Object.entries(adapters)) {
			if (!adapter) continue;

			const found = yield* adapter.locate(externalId).pipe(
				Effect.catchAll((error: ProviderError) => {
					refusal ??= error;
					return Effect.succeed(null);
				}),
			);

			if (found) return Option.some([id as ProviderId, found] as const);
		}

		if (refusal) return yield* Effect.fail(refusal);

		return Option.none();
	});

/**
 * What to call the row: what was asked for, then what the transcript said, then
 * the handle.
 *
 * The handle is the last resort and a poor one — thirty-six characters of hex
 * is the thing a title exists to replace — so it is cut to the first eight and
 * labelled, which at least reads as a row nobody has named yet.
 */
const named = (asked: string | undefined, found: FoundSession): string =>
	sessionTitle(asked) ??
	sessionTitle(found.title) ??
	`imported · ${found.externalId.slice(0, 8)}`;
