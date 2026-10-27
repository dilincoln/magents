import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import type { Session } from "../db/schema";
import { sessions } from "../db/schema";
import { DatabaseError } from "../errors/database-error";
import { Database } from "./database";

/**
 * Lights a session's row, or puts it out.
 *
 * The one write in here that is not about what a session *is*. Everything else
 * stored on a row is a fact about the conversation — its handle, its project,
 * what it runs on — and this is a fact about the people looking at it: whether
 * anybody has. It lives in the database anyway, and that is the decision worth
 * defending, because a screen would be the obvious home for it. Two TUIs on one
 * daemon have to agree about which rows are lit, and a flag held in one of them
 * is a flag the other one is wrong about; and the interesting case — a session
 * that finished while nothing was watching — is precisely the one where there
 * was no screen to hold it.
 *
 * `Option` rather than a throw for a missing row, the same as `renameSession`
 * and `removeSession`: a hook firing a moment after somebody removed the
 * session is not a failure of anything, it is two things happening at once.
 */
export const setAttention = (
	id: string,
	requiresAttention: boolean,
): Effect.Effect<Option.Option<Session>, DatabaseError, Database> =>
	Effect.gen(function* () {
		const { db } = yield* Database;

		const row = yield* Effect.try({
			try: () =>
				db
					.update(sessions)
					.set({ requiresAttention })
					.where(eq(sessions.id, id))
					.returning()
					.get(),
			catch: (cause) => new DatabaseError({ operation: "setAttention", cause }),
		});

		return Option.fromNullable(row);
	});
