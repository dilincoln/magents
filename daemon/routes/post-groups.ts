import { Effect, Option } from "effect";
import { MalformedRequestError } from "../errors/malformed-request-error";
import { sessionTitle } from "../lib/session-title";
import { createGroup } from "../services/create-group";
import type { Database } from "../services/database";

/**
 * `POST /groups` with `{ projectId, title, default?, hibernates? }`.
 *
 * The title goes through the same clamp a session's does, and deliberately the
 * same one: a group heading and a session row are read in the same narrow
 * column, so a rule that let one of them be a paragraph would only move the
 * problem.
 *
 * 409 for a name the project already has. It is the one refusal a person can do
 * something about — pick another name, or go and use the group they forgot they
 * made — so it gets its own code and its own sentence rather than arriving as a
 * constraint failure through the 500.
 */
export const postGroups = (
	request: Request,
): Effect.Effect<Response, never, Database> =>
	Effect.gen(function* () {
		const body = yield* Effect.tryPromise({
			try: () => request.json() as Promise<Record<string, unknown>>,
			catch: () => new MalformedRequestError({ reason: "body is not JSON" }),
		});

		const projectId = body.projectId;

		if (typeof projectId !== "string" || !projectId) {
			return yield* new MalformedRequestError({
				reason: "expected a string `projectId`",
			});
		}

		const title = sessionTitle(
			typeof body.title === "string" ? body.title : null,
		);

		if (!title) {
			return yield* new MalformedRequestError({
				reason: "expected a non-empty `title`",
			});
		}

		const group = yield* createGroup(
			projectId,
			title,
			body.default === true,
			body.hibernates === true,
		);

		return Option.match(group, {
			onNone: () =>
				Response.json(
					{ error: `this project already has a group called ${title}` },
					{ status: 409 },
				),
			onSome: (row) => Response.json(row, { status: 201 }),
		});
	}).pipe(
		Effect.catchTags({
			MalformedRequestError: (error) =>
				Effect.succeed(Response.json({ error: error.reason }, { status: 400 })),
			DatabaseError: (error) =>
				Effect.succeed(
					Response.json(
						// the one database failure a caller can act on: a projectId that
						// names nothing trips the foreign key, and "createGroup failed"
						// would send them looking in the wrong place
						{
							error: `${error.operation} failed — is that project registered?`,
						},
						{ status: 500 },
					),
				),
		}),
	);
