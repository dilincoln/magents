import { Data } from "effect";

/**
 * Anything the database refused. `operation` names the call site, because a
 * bare SQLite message ("FOREIGN KEY constraint failed") says what broke but
 * never what was being attempted.
 */
export class DatabaseError extends Data.TaggedError("DatabaseError")<{
	readonly operation: string;
	readonly cause: unknown;
}> {}
