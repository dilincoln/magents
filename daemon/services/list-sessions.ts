import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { sessions } from "../db/schema";
import { DatabaseError } from "../errors/database-error";
import { Database } from "./database";
import { type LiveSession, Terminals } from "./terminals";

/**
 * Ordered by id, which for UUIDv7 means ordered by when they were opened.
 *
 * The registry is laid over the stored rows on the way out, and that one line
 * deletes a whole class of wrongness from the screen: a `pid` column is a
 * projection written a moment after the fact, so a row read between a spawn and
 * its write says the session is dead when it is not. In memory the answer is
 * exact. It costs nothing to prefer it, and while the daemon is down the client
 * cannot reach this route at all — so there is no case where the column is the
 * better answer.
 *
 * The overlay carries `state` as well as `pid`, and that is what a roster has to
 * read to be right during a settling window: a session whose provider takes two
 * seconds to become resumable has no process to name a pid for, and is coming up
 * rather than dead.
 */
export const listSessions = (
	projectId?: string,
): Effect.Effect<LiveSession[], DatabaseError, Database | Terminals> =>
	Effect.gen(function* () {
		const { db } = yield* Database;
		const terminals = yield* Terminals;

		const rows = yield* Effect.try({
			try: () => {
				const query = db.select().from(sessions);
				return projectId
					? query
							.where(eq(sessions.projectId, projectId))
							.orderBy(sessions.id)
							.all()
					: query.orderBy(sessions.id).all();
			},
			catch: (cause) => new DatabaseError({ operation: "listSessions", cause }),
		});

		return rows.map((row) => terminals.overlay(row));
	});
