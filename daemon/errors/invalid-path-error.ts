import { Data } from "effect";

/**
 * The path a caller wants to register is not a directory that exists. Kept
 * apart from `DatabaseError` because nothing is wrong with the daemon here —
 * the request was wrong, and the caller is the one who can fix it.
 */
export class InvalidPathError extends Data.TaggedError("InvalidPathError")<{
	readonly path: string;
	readonly reason: string;
}> {}
