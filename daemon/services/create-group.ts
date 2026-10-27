import { and, eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { drizzleFraciSync } from "fraci/drizzle";
import type { Group } from "../db/schema";
import { groupOrder, groups } from "../db/schema";
import { DatabaseError } from "../errors/database-error";
import { asGroup } from "../lib/as-group";
import { withPosition } from "../lib/with-position";
import { Database } from "./database";

/**
 * Makes a bucket in a project, at the end of the ones already there.
 *
 * `Option.none` means the name is taken. It is not an error worth a stack: a
 * project cannot hold two groups called `Active` — the tree would be unreadable
 * and every reference to one ambiguous — and the caller asking is a person who
 * has forgotten they made it, not a bug. `onConflictDoNothing` rather than a
 * look-then-insert, so two clients racing the same name get one group and one
 * refusal instead of a constraint error nobody can act on.
 *
 * That conflict is now named rather than blanket, and it has to be. There are
 * two unique indexes on this table since groups gained an order, and an
 * unqualified `onConflictDoNothing` swallows both — so a sort key that
 * collided would have come back as `Option.none` and been reported to somebody
 * as a name they had already used. Naming the title's columns leaves the key's
 * conflict to throw, where `withPosition` is waiting for it.
 *
 * At the end, because that is what making one means: a new bucket has no
 * position among the others that anybody has expressed, and the only honest
 * place for it is after everything that was already arranged. Moving it is a
 * separate act with a separate key — see `reorderGroup`.
 *
 * Made default in the same transaction that clears the old one, because a
 * project with two defaults is a project whose next session lands somewhere
 * arbitrary. The unique index makes it impossible rather than unlikely — this
 * is what keeps that index from firing.
 */
export const createGroup = (
	projectId: string,
	title: string,
	isDefault: boolean,
	hibernates: boolean,
): Effect.Effect<Option.Option<Group>, DatabaseError, Database> =>
	Effect.gen(function* () {
		const { db } = yield* Database;

		const row = yield* Effect.try({
			try: () =>
				db.transaction((tx) => {
					if (isDefault) {
						tx.update(groups)
							.set({ isDefault: false })
							.where(
								and(
									eq(groups.projectId, projectId),
									eq(groups.isDefault, true),
								),
							)
							.run();
					}

					// Inside the transaction, so the last key is read and the row that
					// follows it is written with nothing able to land in between.
					const order = drizzleFraciSync(tx, groupOrder);
					const after = order.indicesForLast({ projectId });

					return withPosition(order.generateKeyBetween(...after), (position) =>
						tx
							.insert(groups)
							.values({ projectId, title, isDefault, hibernates, position })
							.onConflictDoNothing({
								target: [groups.projectId, groups.title],
							})
							.returning()
							.get(),
					);
				}),
			catch: (cause) => new DatabaseError({ operation: "createGroup", cause }),
		});

		return Option.fromNullable(row).pipe(Option.map(asGroup));
	});
