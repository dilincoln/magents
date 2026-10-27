import { Effect, Option } from "effect";
import type { Session } from "../db/schema";
import { MalformedRequestError } from "../errors/malformed-request-error";
import type { Database } from "../services/database";
import { moveSession } from "../services/move-session";
import { renameSession } from "../services/rename-session";
import { setAttention } from "../services/set-attention";
import type { Terminals } from "../services/terminals";

/**
 * `PATCH /sessions/:id` with a new `title`, a new `requiresAttention`, a new
 * `groupId`, or any combination.
 *
 * It was one field and the comment here said it stayed a PATCH "because that is
 * what it will be when there is a second editable field, and a `/rename` route
 * would have to be retired the day there is one". This is that day.
 *
 * Three services rather than one update, because they are three operations and
 * this codebase keeps one per file. They also have genuinely different callers:
 * a rename comes from a person typing a name, attention comes from a hook inside
 * an agent's own process, and a move comes from somebody dragging a session into
 * a bucket. Nothing sends more than one, and the route allows combinations only
 * because refusing them would be a rule with no reason behind it.
 *
 * The move is applied last on purpose. A group may say `hibernates`, so moving
 * can stop the agent — and the row that goes back has to be the one from after
 * that happened, not a snapshot taken before.
 *
 * A body with none of them is refused rather than answered with the unchanged
 * row. "I asked you to change something" and "I asked you to change nothing"
 * are different requests, and the second one is a caller with a bug.
 */
export const patchSession = (
	id: string,
	request: Request,
): Effect.Effect<Response, never, Database | Terminals> =>
	Effect.gen(function* () {
		const body = yield* Effect.tryPromise({
			try: () => request.json() as Promise<Record<string, unknown>>,
			catch: () => new MalformedRequestError({ reason: "body is not JSON" }),
		});

		const title = typeof body.title === "string" ? body.title : null;
		const attention =
			typeof body.requiresAttention === "boolean"
				? body.requiresAttention
				: null;

		/*
		 * `groupId` is present-or-absent rather than truthy-or-not, because null
		 * is one of its two useful values: `{ groupId: null }` is "take it out of
		 * whatever bucket it is in", which is a real request and the only way to
		 * express it.
		 */
		const moving = "groupId" in body;
		const groupId =
			typeof body.groupId === "string" && body.groupId ? body.groupId : null;

		if (title === null && attention === null && !moving) {
			return yield* new MalformedRequestError({
				reason: "expected `title`, `requiresAttention` or `groupId`",
			});
		}

		if (title !== null && !title.trim()) {
			return yield* new MalformedRequestError({
				reason: "expected a non-empty `title`",
			});
		}

		// Whichever were asked for, in the order they are written above. The last
		// answer is the one returned, so a request carrying both gets the row with
		// both changes on it rather than a snapshot from halfway through.
		let row: Option.Option<Session> = Option.none();

		if (title !== null) row = yield* renameSession(id, title);
		if (attention !== null) row = yield* setAttention(id, attention);
		// Last, so the row that goes back carries whatever the move did to the
		// process — a group that hibernates has already stopped the agent by the
		// time this answers, and the overlay says so.
		if (moving) row = yield* moveSession(id, groupId);

		return Option.match(row, {
			onNone: () =>
				Response.json({ error: "no such session" }, { status: 404 }),
			onSome: (session) => Response.json(session),
		});
	}).pipe(
		Effect.catchTags({
			MalformedRequestError: (error) =>
				Effect.succeed(Response.json({ error: error.reason }, { status: 400 })),
			DatabaseError: (error) =>
				Effect.succeed(
					Response.json(
						{ error: `${error.operation} failed` },
						{ status: 500 },
					),
				),
		}),
	);
