import { Effect } from "effect";
import { MalformedRequestError } from "../errors/malformed-request-error";
import { createProject } from "../services/create-project";
import type { Database } from "../services/database";
import { resolveProjectPath } from "../services/resolve-project-path";

/**
 * `POST /projects` with `{ "path": "/home/you/code/thing" }`.
 *
 * Idempotent, because `createProject` is: registering a path that is already
 * registered returns the existing row rather than a conflict. The caller asked
 * for the project to exist, and afterwards it does — which is the same answer
 * either way, so it is the same 201 either way.
 */
export const postProjects = (
	request: Request,
): Effect.Effect<Response, never, Database> =>
	Effect.gen(function* () {
		const body = yield* Effect.tryPromise({
			try: () => request.json() as Promise<unknown>,
			catch: () => new MalformedRequestError({ reason: "body is not JSON" }),
		});

		const path =
			typeof body === "object" && body !== null && "path" in body
				? (body as { path: unknown }).path
				: undefined;

		if (typeof path !== "string") {
			return yield* new MalformedRequestError({
				reason: "expected a string `path`",
			});
		}

		const resolved = yield* resolveProjectPath(path);
		const project = yield* createProject(resolved);

		return Response.json(project, { status: 201 });
	}).pipe(
		// One place decides what each failure looks like on the wire. The client
		// gets a sentence it can put on the screen, not a stack trace.
		Effect.catchTags({
			MalformedRequestError: (error) =>
				Effect.succeed(Response.json({ error: error.reason }, { status: 400 })),
			InvalidPathError: (error) =>
				Effect.succeed(
					Response.json(
						// no dangling colon when there was no path to name
						{
							error: error.path
								? `${error.reason}: ${error.path}`
								: error.reason,
						},
						{ status: 400 },
					),
				),
			DatabaseError: (error) =>
				Effect.succeed(
					Response.json(
						{ error: `${error.operation} failed` },
						{ status: 500 },
					),
				),
		}),
	);
