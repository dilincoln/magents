import { Effect } from "effect";
import { MalformedRequestError } from "../errors/malformed-request-error";
import type { Database } from "../services/database";
import { importSession } from "../services/import-session";
import type { Terminals } from "../services/terminals";

/**
 * `POST /sessions/import` with the provider's own handle for a conversation.
 *
 * The one route that takes an id it did not mint. Everywhere else `externalId`
 * is something the daemon learned; here it is the whole request, because the
 * conversation was started in somebody's terminal and its handle is all that
 * exists to point at it.
 *
 * No provider in the body, on purpose — see `importSession`. Both are asked and
 * the filesystem answers, so there is no way for the client to be wrong about
 * something it cannot know.
 *
 * `title` is the opposite case and that is why it *is* in the body: nothing on
 * disk knows what you want this called. Optional here and required by the
 * screen, which is not a contradiction — the screen has somebody to ask.
 *
 * A 404 for a handle nobody recognises. That is the same code `/sessions/:id`
 * gives for a row that is not there, and it means the same thing here: you
 * named something and there is no such thing.
 */
export const postSessionImport = (
	request: Request,
): Effect.Effect<Response, never, Database | Terminals> =>
	Effect.gen(function* () {
		const body = yield* Effect.tryPromise({
			try: () => request.json() as Promise<Record<string, unknown>>,
			catch: () => new MalformedRequestError({ reason: "body is not JSON" }),
		});

		const externalId =
			typeof body.externalId === "string" ? body.externalId.trim() : "";

		if (!externalId) {
			return yield* new MalformedRequestError({
				reason: "expected a non-empty `externalId`",
			});
		}

		const title = typeof body.title === "string" ? body.title : undefined;

		const imported = yield* importSession(externalId, title);

		// 200 for a handle that was already in the roster. Importing it twice is
		// not an error — the second ask has the same answer as the first — but
		// nothing was created, and 201 would say something was.
		return Response.json(imported, { status: imported.created ? 201 : 200 });
	}).pipe(
		Effect.catchTags({
			MalformedRequestError: (error) =>
				Effect.succeed(Response.json({ error: error.reason }, { status: 400 })),
			UnknownSessionError: (error) =>
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
