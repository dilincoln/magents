import { eq } from "drizzle-orm";
import { Effect } from "effect";
import type { ProviderId } from "../db/schema";
import { projects, sessions } from "../db/schema";
import { DatabaseError } from "../errors/database-error";
import { InvalidPathError } from "../errors/invalid-path-error";
import type { ProviderError } from "../errors/provider-error";
import { ProviderError as Provider } from "../errors/provider-error";
import { sessionTitle } from "../lib/session-title";
import { adapters } from "../providers/adapters";
import { Database } from "./database";
import { defaultGroup } from "./list-groups";
import { type LiveSession, Terminals } from "./terminals";

export interface OpenSessionInput {
	projectId: string;
	provider: ProviderId;
	prompt: string;
	model: string | null;
	variant: string | null;
	/**
	 * What to call it, when the caller has something better than the prompt.
	 *
	 * Null is the ordinary case and not an oversight: somebody typing into the
	 * spawn panel has just written the one sentence that says what they want, and
	 * asking them to write it again in a name field would be asking twice for the
	 * same thing. The CLI is the caller with more to say — a prompt there is
	 * often a paragraph piped in from a file, whose first line makes a poor name
	 * — so it gets a flag, and this is where the flag lands.
	 */
	title: string | null;
	/**
	 * The bucket to open it in.
	 *
	 * Three answers, and they are three different things a caller can mean.
	 * `undefined` is "you decide", which is what the spawn panel and the CLI
	 * send when nobody touched the picker, and it lands in the project's default
	 * group if it has one. A string is a bucket somebody chose. `null` is
	 * "no bucket, on purpose" — the panel's own *none* option — and it has to be
	 * distinguishable from not asking, or a project with a default would make
	 * that option impossible to express.
	 */
	groupId?: string | null;
}

/**
 * A session that exists.
 *
 * It used to carry the argv beside the row — the daemon telling the client what
 * to execute, which was the point while the terminal lived over there. Nothing
 * runs it any more: the process is started here, on this side, before this
 * returns, and a command on the wire would now be an invitation to start a
 * second agent on the same conversation.
 */
export interface OpenedSession {
	session: LiveSession;
}

/**
 * Opens a session: asks the provider for one, then writes down where it is.
 *
 * Minting before writing is the order, and the reason is that a provider which
 * refuses should leave no row behind — a row is a promise that something can be
 * reattached to, and one written before the provider agreed would be a session
 * that exists only in our database and nowhere a terminal can reach.
 *
 * Both providers answer straight away now, and for a while one did not. Codex
 * would not be told what to call a session and would not save one until a run
 * had happened, so its `open` ran the whole first turn — `magents new -p codex`
 * held the request for two minutes and eight seconds while the identical claude
 * command answered instantly. The order was inverted for it, behind an
 * `opensInBackground` flag: row first, with no handle, and the open finishing
 * on its own afterwards. That is gone, and the flag with it, because codex's
 * adapter found a way to hand codex the id after all (see `codex.ts`); what
 * remains is the one order, and the promise above holds for both.
 */
export const openSession = (
	input: OpenSessionInput,
): Effect.Effect<
	OpenedSession,
	DatabaseError | ProviderError | InvalidPathError,
	Database | Terminals
> =>
	Effect.gen(function* () {
		const { db } = yield* Database;
		const terminals = yield* Terminals;

		const project = yield* Effect.try({
			try: () =>
				db
					.select()
					.from(projects)
					.where(eq(projects.id, input.projectId))
					.get(),
			catch: (cause) =>
				new DatabaseError({ operation: "openSession/project", cause }),
		});

		if (!project) {
			return yield* new InvalidPathError({
				path: input.projectId,
				reason: "no such project",
			});
		}

		const adapter = adapters[input.provider];

		if (!adapter) {
			return yield* new Provider({
				provider: input.provider,
				reason: `${input.provider} cannot open sessions yet`,
			});
		}

		/*
		 * Where it lands, resolved here rather than at every door.
		 *
		 * The default is read at open time and not baked into anything, so
		 * changing which bucket a project defaults to changes where the next
		 * session goes and says nothing about the ones already placed. That is
		 * the only reading that survives somebody reorganising: a stored copy
		 * would make old sessions move when they renamed a group.
		 */
		const group =
			input.groupId === undefined
				? ((yield* defaultGroup(input.projectId))?.id ?? null)
				: input.groupId;

		// Ours before it is anyone's. A provider that accepts an id is handed
		// this one, which is what makes the two sides agree without a lookup.
		const id = Bun.randomUUIDv7();

		const spec = {
			id,
			prompt: input.prompt,
			model: input.model,
			variant: input.variant,
			cwd: project.path,
		};

		/** The row, with whatever handle is known by the time it is written. */
		const write = (externalId: string | null) =>
			Effect.try({
				try: () =>
					db
						.insert(sessions)
						.values({
							id,
							projectId: input.projectId,
							groupId: group,
							provider: input.provider,
							externalId,
							// the name if one was given, the prompt's first line if not, and
							// a word rather than a blank row if neither survives
							title:
								sessionTitle(input.title) ??
								sessionTitle(input.prompt) ??
								"untitled",
							model: input.model,
							variant: input.variant,
							// Lit from the moment it exists, and cleared by the first client
							// to put a cursor on it. The case this is for is a session opened
							// from the CLI in another terminal, which otherwise appears in the
							// roster with nothing to say it is new — but the rule is not
							// "opened by the CLI", because the daemon has no business guessing
							// who is watching. It is "nobody has looked at this yet", which is
							// true of every session the instant it is minted and stops being
							// true when somebody looks.
							requiresAttention: true,
						})
						.returning()
						.get(),
				catch: (cause) =>
					new DatabaseError({ operation: "openSession", cause }),
			});

		/*
		 * Put a terminal on it, and deliberately not waited for. `spawn` puts the
		 * settling time on a timer and returns.
		 *
		 * This is the one spawn that does not go through `startTerminal`: the
		 * command here is the one that *creates* the conversation, and it exists
		 * only in this adapter call. Resuming a session it never ran would find
		 * nothing to resume.
		 *
		 * A spawn that refuses outright is not raised, unlike in `startTerminal`.
		 * The row is written and the conversation exists, so the session genuinely
		 * was opened and failing would be the wrong sentence about it; what the CLI
		 * said is in the session's history and on its next `session` frame, which
		 * is where a client is looking anyway.
		 */
		const start = (argv: string[]): void => {
			terminals.spawn(
				id,
				argv,
				project.path,
				adapter.attachDelayMs,
				adapter.env,
			);
		};

		const launch = yield* adapter.open(spec);
		const session = yield* write(launch.externalId);

		if (terminals.claimStart(id)) start(launch.argv);

		// the same overlay `listSessions` does, and for the same reason: the row
		// was returned by the insert, before there was a process to name on it
		return { session: terminals.overlay(session) };
	});
