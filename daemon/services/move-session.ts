import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import type { Session } from "../db/schema";
import { groups, sessions } from "../db/schema";
import { DatabaseError } from "../errors/database-error";
import { Database } from "./database";
import { Terminals } from "./terminals";

/**
 * Puts a session in a different bucket, or in none.
 *
 * The only field on a session besides its title that a person changes, and the
 * only one with a consequence attached: a group may say `hibernates`, and
 * moving into one stops the agent.
 *
 * That is the whole idea of groups working as a lane rather than a label. A
 * bucket called `Done` that puts its agents to sleep is a rule about what
 * `Done` means to *you* — nothing here could have inferred it, and nothing here
 * decides when a session has finished. You say where it goes; the group says
 * what going there means.
 *
 * The kill happens after the write and only on a real change of group. After,
 * because a client told the session moved before it has is a client showing a
 * row that has not moved yet; and only on a change, because re-asserting the
 * group a session is already in — which is what a client resending its own
 * state looks like — is not somebody asking for it to be stopped again.
 *
 * `Option` rather than a throw for a missing row, the same as everything else
 * that takes an id from a list a client is holding.
 */
export const moveSession = (
	id: string,
	groupId: string | null,
): Effect.Effect<Option.Option<Session>, DatabaseError, Database | Terminals> =>
	Effect.gen(function* () {
		const { db } = yield* Database;
		const terminals = yield* Terminals;

		const before = yield* Effect.try({
			try: () => db.select().from(sessions).where(eq(sessions.id, id)).get(),
			catch: (cause) =>
				new DatabaseError({ operation: "moveSession/find", cause }),
		});

		if (!before) return Option.none<Session>();

		const row = yield* Effect.try({
			try: () =>
				db
					.update(sessions)
					.set({ groupId })
					.where(eq(sessions.id, id))
					.returning()
					.get(),
			catch: (cause) => new DatabaseError({ operation: "moveSession", cause }),
		});

		if (!row) return Option.none<Session>();

		const moved = before.groupId !== groupId;

		if (moved && groupId) {
			const target = yield* Effect.try({
				try: () => db.select().from(groups).where(eq(groups.id, groupId)).get(),
				catch: (cause) =>
					new DatabaseError({ operation: "moveSession/group", cause }),
			});

			// A group that has been removed under the caller cannot say anything
			// about what landing in it means, and the foreign key has already
			// nulled the column by then anyway.
			if (target?.hibernates) {
				yield* Effect.promise(() => terminals.kill(id));
			}
		}

		// re-read rather than returning the row from the update: the kill above
		// changed what `state` and `pid` should say, and the overlay is where
		// that lives
		return Option.some(terminals.overlay(row));
	});
