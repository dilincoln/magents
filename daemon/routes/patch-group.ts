import { Effect, Option } from "effect";
import type { Group } from "../db/schema";
import { MalformedRequestError } from "../errors/malformed-request-error";
import { sessionTitle } from "../lib/session-title";
import type { Database } from "../services/database";
import { reorderGroup } from "../services/reorder-group";
import { updateGroup } from "../services/update-group";

/**
 * `PATCH /groups/:id` with a new `title`, `default: true`, `hibernates`,
 * `collapsed`, a new place in the list via `after`, or any combination.
 *
 * The same shape as `PATCH /sessions/:id` and for the same reason: these are
 * the things about a group anybody is allowed to change, and a `/default`
 * route beside a `/rename` one would be two doors onto one row that have to be
 * kept in step.
 *
 * `hibernates` takes either value — "stop putting things to sleep here" has one
 * obvious meaning. `default: false` is refused rather than ignored, and the
 * asymmetry is the point: A project either has a home
 * for new sessions or it has not, and the way to stop a group being the default
 * is to make another one it — see `updateGroup`. Accepting the word and doing
 * nothing would be the worst of the three answers.
 *
 * `after` is present-or-absent rather than truthy-or-not, because null is one
 * of its two useful values: `{ after: null }` is "put it first", the one
 * position with no neighbour in front of it to be named by. It is the same
 * reading `groupId: null` gets one table over.
 *
 * The reorder is applied last, so a request that also renamed comes back with
 * both changes on it rather than a snapshot from halfway through.
 */
export const patchGroup = (
	id: string,
	request: Request,
): Effect.Effect<Response, never, Database> =>
	Effect.gen(function* () {
		const body = yield* Effect.tryPromise({
			try: () => request.json() as Promise<Record<string, unknown>>,
			catch: () => new MalformedRequestError({ reason: "body is not JSON" }),
		});

		const title =
			body.title === undefined
				? undefined
				: sessionTitle(typeof body.title === "string" ? body.title : null);

		if (body.title !== undefined && !title) {
			return yield* new MalformedRequestError({
				reason: "expected a non-empty `title`",
			});
		}

		if (body.default !== undefined && body.default !== true) {
			return yield* new MalformedRequestError({
				reason:
					"`default` can only be set — make another group the default instead",
			});
		}

		if (body.hibernates !== undefined && typeof body.hibernates !== "boolean") {
			return yield* new MalformedRequestError({
				reason: "expected `hibernates` to be a boolean",
			});
		}

		// Sent as the state it should end in rather than as a toggle, which is
		// the whole reason two TUIs can share this: a toggle applied twice by two
		// windows that both saw it open leaves it open, and neither of them asked
		// for that.
		if (body.collapsed !== undefined && typeof body.collapsed !== "boolean") {
			return yield* new MalformedRequestError({
				reason: "expected `collapsed` to be a boolean",
			});
		}

		const placing = "after" in body;

		if (placing && body.after !== null && typeof body.after !== "string") {
			return yield* new MalformedRequestError({
				reason: "expected `after` to be a group id, or null for first",
			});
		}

		const editing =
			title !== undefined ||
			body.default !== undefined ||
			body.hibernates !== undefined ||
			body.collapsed !== undefined;

		if (!editing && !placing) {
			return yield* new MalformedRequestError({
				reason:
					"expected `title`, `default`, `hibernates`, `collapsed` or `after`",
			});
		}

		// Whichever were asked for. The last answer is the one returned, so a
		// request carrying both gets the row with both changes on it rather than
		// a snapshot from halfway through.
		let group: Option.Option<Group> = Option.none();

		// `title` is either a non-empty string or absent by this point — the two
		// guards above turned "sent, but blank" into a 400 — so a falsy one here
		// means nobody asked for a rename.
		if (editing) {
			group = yield* updateGroup(id, {
				...(title ? { title } : {}),
				...(body.default === true ? { isDefault: true as const } : {}),
				...(typeof body.hibernates === "boolean"
					? { hibernates: body.hibernates }
					: {}),
				...(typeof body.collapsed === "boolean"
					? { collapsed: body.collapsed }
					: {}),
			});
		}

		if (placing) {
			group = yield* reorderGroup(
				id,
				typeof body.after === "string" && body.after ? body.after : null,
			);
		}

		return Option.match(group, {
			onNone: () => Response.json({ error: "no such group" }, { status: 404 }),
			onSome: (row) => Response.json(row),
		});
	}).pipe(
		Effect.catchTags({
			MalformedRequestError: (error) =>
				Effect.succeed(Response.json({ error: error.reason }, { status: 400 })),
			DatabaseError: (error) =>
				Effect.succeed(
					Response.json(
						{ error: `${error.operation} failed — is that name taken?` },
						{ status: 500 },
					),
				),
		}),
	);
