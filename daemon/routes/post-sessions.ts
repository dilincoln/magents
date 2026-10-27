import { Effect } from "effect";
import { PROVIDERS, type ProviderId } from "../db/schema";
import { MalformedRequestError } from "../errors/malformed-request-error";
import type { Database } from "../services/database";
import { openSession } from "../services/open-session";
import type { Terminals } from "../services/terminals";

/**
 * `POST /sessions` with a project, a provider, a prompt and what to run it on.
 *
 * The response used to carry the argv beside the row — the daemon telling the
 * client what to execute, which was defensible only while the adapter lived on
 * this side and the terminal that ran it lived on the other. The terminal is
 * here now, so `OpenedSession` is `{ session }` and no command crosses the
 * socket in either direction: by the time this answers, the process is already
 * spawned and its pid is on the row that goes back. An argv on the wire would
 * now be an invitation to start a second agent on the same conversation.
 *
 * "Already spawned" and "already running" are not the same claim, and only the
 * first is made here: for codex the request answers inside the adapter's
 * settling window, so the row goes back with a null pid and `state: "starting"`
 * and the process appears about two seconds later.
 */
export const postSessions = (
	request: Request,
): Effect.Effect<Response, never, Database | Terminals> =>
	Effect.gen(function* () {
		const body = yield* Effect.tryPromise({
			try: () => request.json() as Promise<Record<string, unknown>>,
			catch: () => new MalformedRequestError({ reason: "body is not JSON" }),
		});

		const projectId = text(body.projectId);
		const provider = text(body.provider);
		const prompt = text(body.prompt);

		if (!projectId) {
			return yield* new MalformedRequestError({
				reason: "expected a string `projectId`",
			});
		}

		if (!provider || !(PROVIDERS as readonly string[]).includes(provider)) {
			return yield* new MalformedRequestError({
				reason: `expected \`provider\` to be one of ${PROVIDERS.join(", ")}`,
			});
		}

		if (!prompt?.trim()) {
			return yield* new MalformedRequestError({
				reason: "expected a non-empty `prompt`",
			});
		}

		const opened = yield* openSession({
			projectId,
			provider: provider as ProviderId,
			prompt,
			model: text(body.model) ?? null,
			variant: text(body.variant) ?? null,
			// absent is the spawn panel, which has no name field and means "take it
			// from the prompt"; a blank `--name ''` means the same, so both arrive as
			// null rather than as a title nobody can read
			title: text(body.title) ?? null,
			// Three-valued on purpose, and this is the one place the distinction
			// has to survive a JSON round trip. Absent means "you decide", which
			// lands in the project's default group; a string is a bucket somebody
			// picked; an explicit `null` is the panel's *none*, which has to be
			// able to beat a default or the option is unusable in the one kind of
			// project that has one.
			...("groupId" in body ? { groupId: text(body.groupId) ?? null } : {}),
		});

		return Response.json(opened, { status: 201 });
	}).pipe(
		Effect.catchTags({
			MalformedRequestError: (error) =>
				Effect.succeed(Response.json({ error: error.reason }, { status: 400 })),
			InvalidPathError: (error) =>
				Effect.succeed(Response.json({ error: error.reason }, { status: 404 })),
			// the provider's own words, the same as everywhere else it is asked
			ProviderError: (error) =>
				Effect.succeed(Response.json({ error: error.reason }, { status: 502 })),
			DatabaseError: (error) =>
				Effect.succeed(
					Response.json(
						{ error: `${error.operation} failed` },
						{ status: 500 },
					),
				),
		}),
	);

const text = (value: unknown): string | undefined =>
	typeof value === "string" ? value : undefined;
