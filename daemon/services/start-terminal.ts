import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { projects, sessions } from "../db/schema";
import { DatabaseError } from "../errors/database-error";
import type { ProviderError } from "../errors/provider-error";
import { TerminalError } from "../errors/terminal-error";
import { adapters } from "../providers/adapters";
import { Database } from "./database";
import { type LiveSession, Terminals } from "./terminals";

/**
 * Puts a process back on a session, or says why there cannot be one.
 *
 * The single door to a spawn that is not the one opening the session itself:
 * an explicit restart, and a client's answer to being told the session it
 * attached to has never run. Everything a terminal needs is worked out here so
 * that no command ever crosses the socket — the adapter that knows how to
 * resume a provider lives on this side of it, and the client asks for a
 * terminal rather than for an argv.
 *
 * The claim is taken first, before the row is even read. That ordering is the
 * whole race: `claimStart` is a `has` and a `set` inside one synchronous
 * function, so two callers arriving a millisecond apart cannot both come away
 * believing they are the one starting the session, however the fibers between
 * them are scheduled. Reading the row first would put an await between the
 * check and the claim and open exactly the window it exists to close.
 *
 * `Option` rather than a throw for a missing row, the same as `removeSession`:
 * "there is no such session" is the caller's list being stale and is worth
 * telling apart from "there is a session and it cannot be started".
 */
export const startTerminal = (
	sessionId: string,
): Effect.Effect<
	Option.Option<LiveSession>,
	TerminalError | DatabaseError | ProviderError,
	Database | Terminals
> =>
	Effect.gen(function* () {
		const terminals = yield* Terminals;

		if (!terminals.claimStart(sessionId)) {
			return yield* new TerminalError({
				sessionId,
				reason: "already running",
			});
		}

		// a claim that leads nowhere has to be put back, or the session is
		// "already running" for the life of the daemon on the strength of one
		// attempt that never started anything
		const started = yield* begin(sessionId).pipe(
			Effect.tapError(() => Effect.sync(() => terminals.abandon(sessionId))),
		);

		if (Option.isNone(started)) terminals.abandon(sessionId);

		return started;
	});

const begin = (
	sessionId: string,
): Effect.Effect<
	Option.Option<LiveSession>,
	TerminalError | DatabaseError | ProviderError,
	Database | Terminals
> =>
	Effect.gen(function* () {
		const { db } = yield* Database;
		const terminals = yield* Terminals;

		const row = yield* Effect.try({
			try: () =>
				db.select().from(sessions).where(eq(sessions.id, sessionId)).get(),
			catch: (cause) =>
				new DatabaseError({ operation: "startTerminal/session", cause }),
		});

		if (!row) return Option.none<LiveSession>();

		const adapter = adapters[row.provider];

		if (!adapter) {
			return yield* new TerminalError({
				sessionId,
				reason: "no handle",
				detail: `${row.provider} cannot be resumed`,
			});
		}

		// A row without a handle is one from before codex took ours: its open
		// ran `codex exec` and failed before the id came back. Nothing can be
		// learned about it now, so it is said rather than searched for.
		if (!row.externalId) {
			return yield* new TerminalError({
				sessionId,
				reason: "no handle",
				detail: `this session has no handle on ${row.provider} to reattach to`,
			});
		}

		const project = yield* Effect.try({
			try: () =>
				db.select().from(projects).where(eq(projects.id, row.projectId)).get(),
			catch: (cause) =>
				new DatabaseError({ operation: "startTerminal/project", cause }),
		});

		if (!project) {
			return yield* new TerminalError({
				sessionId,
				reason: "no handle",
				detail: "the project this session belongs to is gone",
			});
		}

		const failure = terminals.spawn(
			sessionId,
			adapter.resume(row.externalId, project.path),
			project.path,
			adapter.attachDelayMs,
			adapter.env,
		);

		// The one place `spawn failed` can be constructed, and the reason the
		// variant exists: a provider binary missing from PATH used to answer 200
		// with a session that looked fine. Only a provider with no settling time
		// can be answered this way — codex's start is on a timer and this request
		// is over long before it runs — which is why the failure is also written
		// into the session's own history where a client can still read it.
		if (failure) {
			return yield* new TerminalError({
				sessionId,
				reason: "spawn failed",
				detail: failure.message,
				cause: failure,
			});
		}

		// with what the registry knows over the top of the stored row, for the
		// same reason `listSessions` does it: the row was read before there was a
		// process, and answering a start with a session that says nothing is
		// running would have the caller paint it dead until the next heartbeat
		// corrected it. `state` is the half that covers a provider still settling,
		// where there is no pid to give yet and `starting` is the whole answer.
		return Option.some(terminals.overlay(row));
	});
