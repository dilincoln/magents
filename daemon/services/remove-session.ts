import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import type { Session } from "../db/schema";
import { sessions } from "../db/schema";
import { DatabaseError } from "../errors/database-error";
import { Database } from "./database";
import { Terminals } from "./terminals";

/**
 * Forgets a session.
 *
 * Only the row. The conversation belongs to the provider's CLI, which wrote it
 * and still has it — this drops the pointer, not the transcript. That is not a
 * caveat to apologise for, it is the same fact that makes `resume` work at all:
 * nothing here was ever the record.
 *
 * `Option` rather than a boolean, for the same reason `removeProject` uses one:
 * asking to remove a session that is not there means the caller's list is
 * stale, and that is worth telling apart from a removal that happened.
 *
 * The agent is killed first and the row deleted after, which inverts what the
 * TUI used to do on purpose. Killing on success was right while the two halves
 * lived in different processes — a delete that failed would otherwise have left
 * a row with a dead agent under it. In one process the opposite hazard is worse
 * and it is permanent: delete first, crash in the window, and there is a running
 * agent whose row and pid are both gone, which no boot sweep can ever find. A
 * kill that succeeds against a row that then survives is a session someone can
 * restart; the other way round is a process nobody can reach.
 */
export const removeSession = (
	id: string,
): Effect.Effect<Option.Option<Session>, DatabaseError, Database | Terminals> =>
	Effect.gen(function* () {
		const { db } = yield* Database;
		const terminals = yield* Terminals;

		yield* Effect.promise(() => terminals.kill(id));

		const row = yield* Effect.try({
			try: () =>
				db.delete(sessions).where(eq(sessions.id, id)).returning().get(),
			catch: (cause) =>
				new DatabaseError({ operation: "removeSession", cause }),
		});

		// after the delete, so nobody is told the session is gone before it is
		terminals.disband(id);

		return Option.fromNullable(row);
	});
