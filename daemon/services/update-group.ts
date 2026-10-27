import { and, eq, ne } from "drizzle-orm";
import { Effect, Option } from "effect";
import type { Group } from "../db/schema";
import { groups } from "../db/schema";
import { DatabaseError } from "../errors/database-error";
import { asGroup } from "../lib/as-group";
import { Database } from "./database";

/**
 * Renames a group, makes it the project's default, says whether landing in it
 * puts an agent to sleep, folds it shut — or any combination.
 *
 * The clearing is the whole reason this is a transaction and not an update.
 * "Make this one the default" is really two writes — one bucket stops being it,
 * another starts — and a reader between them would see a project with none or,
 * worse, the unique index would refuse the second write and leave the first.
 *
 * There is no way to say "stop being the default" beyond making another one it,
 * and that is deliberate rather than missing. A project either has a home for
 * new sessions or it has not; toggling the last one off is asking for the
 * second state through a control that looks like it means the first.
 */
export const updateGroup = (
	id: string,
	changes: {
		title?: string;
		isDefault?: true;
		hibernates?: boolean;
		collapsed?: boolean;
	},
): Effect.Effect<Option.Option<Group>, DatabaseError, Database> =>
	Effect.gen(function* () {
		const { db } = yield* Database;

		const row = yield* Effect.try({
			try: () =>
				db.transaction((tx) => {
					const group = tx.select().from(groups).where(eq(groups.id, id)).get();

					if (!group) return undefined;

					if (changes.isDefault) {
						tx.update(groups)
							.set({ isDefault: false })
							.where(
								and(
									eq(groups.projectId, group.projectId),
									eq(groups.isDefault, true),
									ne(groups.id, id),
								),
							)
							.run();
					}

					return tx
						.update(groups)
						.set({
							...(changes.title === undefined ? {} : { title: changes.title }),
							...(changes.isDefault ? { isDefault: true } : {}),
							// unlike `isDefault`, this one turns off as readily as on:
							// "stop hibernating things that land here" is a request with
							// one obvious meaning, where "stop being the default" is not
							...(changes.hibernates === undefined
								? {}
								: { hibernates: changes.hibernates }),
							// both ways too, and for a plainer reason than hibernates:
							// it is a fold, and a fold that could only be closed would
							// be a heading with no way back
							...(changes.collapsed === undefined
								? {}
								: { collapsed: changes.collapsed }),
						})
						.where(eq(groups.id, id))
						.returning()
						.get();
				}),
			catch: (cause) => new DatabaseError({ operation: "updateGroup", cause }),
		});

		return Option.fromNullable(row).pipe(Option.map(asGroup));
	});
