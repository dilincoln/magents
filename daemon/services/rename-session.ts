import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import type { Session } from "../db/schema";
import { sessions } from "../db/schema";
import { DatabaseError } from "../errors/database-error";
import { sessionTitle } from "../lib/session-title";
import { Database } from "./database";

/**
 * Gives a session a different name.
 *
 * The only field on a session a person is allowed to change, and the reason is
 * that it is the only one that is theirs. The handle belongs to the provider,
 * the project is where the conversation ran, the model is what it was started
 * on — all facts, all wrong to edit. The title is the one thing that was only
 * ever a guess at what the conversation is about, made from its first line
 * before anybody knew, and a guess is exactly the kind of thing worth being
 * able to correct.
 *
 * `Option` rather than a throw for a missing row, the same as `removeSession`:
 * a caller working from a stale list is not a failure of this.
 */
export const renameSession = (
	id: string,
	title: string,
): Effect.Effect<Option.Option<Session>, DatabaseError, Database> =>
	Effect.gen(function* () {
		const { db } = yield* Database;

		const name = sessionTitle(title);

		// Guarded here as well as at the route, because the column is `notNull`
		// and a blank name would be a row that cannot be told from any other row
		// with a blank name.
		if (!name) return Option.none<Session>();

		const row = yield* Effect.try({
			try: () =>
				db
					.update(sessions)
					.set({ title: name })
					.where(eq(sessions.id, id))
					.returning()
					.get(),
			catch: (cause) =>
				new DatabaseError({ operation: "renameSession", cause }),
		});

		return Option.fromNullable(row);
	});
