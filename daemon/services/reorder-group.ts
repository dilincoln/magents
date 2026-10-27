import { and, eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { drizzleFraciSync } from "fraci/drizzle";
import type { Group, GroupRow } from "../db/schema";
import { groupOrder, groups } from "../db/schema";
import { DatabaseError } from "../errors/database-error";
import { MalformedRequestError } from "../errors/malformed-request-error";
import { asGroup } from "../lib/as-group";
import { withPosition } from "../lib/with-position";
import { Database } from "./database";

/**
 * Puts a group somewhere else among its project's groups: immediately after
 * the one named, or first when nothing is.
 *
 * "After that one" rather than "at index four", and the difference is what
 * makes this a single write. A position is a number only while nobody else is
 * holding the list; an anchor is a row, and a row is still the row it was
 * after the list around it has changed. The new key is generated strictly
 * between the anchor and whatever follows it, so one UPDATE moves one group
 * and every other key stays exactly as it was.
 *
 * `null` for the anchor means the front, which is the one position that cannot
 * be named by a neighbour — there is nothing before the first row to be after.
 * It is the same reading `PATCH /sessions/:id` gives `groupId: null`: the
 * absence is the request, not the lack of one.
 *
 * Moving a group after itself is answered with the group. It is what a client
 * that recomputed an anchor from a list it was already holding sends, and it
 * asks for the arrangement that is already on the screen — so the honest reply
 * is the row, not a refusal and not a rewritten key.
 *
 * An anchor that is not in the same project is refused rather than ignored.
 * Groups do not travel between projects and there is no key that could place
 * one relative to a bucket in another repository, so the request has no
 * reading at all — which is a `MalformedRequestError` and a 400, not a silent
 * no-op that leaves the caller believing the list moved.
 */
export const reorderGroup = (
	id: string,
	after: string | null,
): Effect.Effect<
	Option.Option<Group>,
	DatabaseError | MalformedRequestError,
	Database
> =>
	Effect.gen(function* () {
		const { db } = yield* Database;

		const outcome = yield* Effect.try({
			try: () =>
				db.transaction(
					(
						tx,
					):
						| { kind: "missing" }
						| { kind: "stranger" }
						| { kind: "placed"; row: GroupRow | undefined } => {
						const row = tx.select().from(groups).where(eq(groups.id, id)).get();

						if (!row) return { kind: "missing" };
						if (after === id) return { kind: "placed", row };

						/*
						 * Read and write inside one transaction, which is the whole
						 * reason this is not two statements. The key is computed from
						 * the anchor's neighbour, so a row landing between the two
						 * halves would produce a key that was strictly between them
						 * when it was worked out and is no longer by the time it is
						 * stored.
						 */
						const order = drizzleFraciSync(tx, groupOrder);
						const between = after
							? order.indicesForAfter(
									{ projectId: row.projectId },
									{ id: after },
								)
							: order.indicesForFirst({ projectId: row.projectId });

						// undefined only from the anchored call, and only when the
						// anchor is not a group of this project — including when it is
						// no group at all.
						if (!between) return { kind: "stranger" };

						/*
						 * Already there. The upper bound fraci hands back is the key of
						 * whatever currently follows the anchor, so when that is this
						 * group's own key the request is asking for the arrangement on
						 * the screen.
						 *
						 * Worth catching rather than writing anyway. The key it would
						 * generate is a *finer* one — strictly between the anchor and
						 * where this row already sits — so asking twice would make the
						 * key longer each time, and a client that reasserts an order it
						 * is already holding would walk the column towards fraci's
						 * length ceiling for no movement at all.
						 */
						if (between[1] && settled(between[1], row.position)) {
							return { kind: "placed", row };
						}

						return {
							kind: "placed",
							row: withPosition(
								order.generateKeyBetween(...between),
								(position) =>
									tx
										.update(groups)
										.set({ position })
										// the project as well as the id, so a key can only
										// ever be written into the list it was computed
										// against
										.where(
											and(
												eq(groups.id, id),
												eq(groups.projectId, row.projectId),
											),
										)
										.returning()
										.get(),
							),
						};
					},
				),
			catch: (cause) => new DatabaseError({ operation: "reorderGroup", cause }),
		});

		if (outcome.kind === "stranger") {
			return yield* new MalformedRequestError({
				reason: "`after` is not a group of the same project",
			});
		}

		if (outcome.kind === "missing") return Option.none<Group>();

		return Option.fromNullable(outcome.row).pipe(Option.map(asGroup));
	});

/**
 * Whether two sort keys are the same key.
 *
 * By bytes, because that is what the database compares them by. They arrive as
 * `Uint8Array`s — bun's SQLite hands blobs back as one and fraci generates
 * one — and those are compared by identity, not by content, so `===` here
 * would answer "no" for two keys that are the same key.
 */
const settled = (a: Uint8Array, b: Uint8Array): boolean =>
	a.length === b.length && a.every((byte, at) => byte === b[at]);
