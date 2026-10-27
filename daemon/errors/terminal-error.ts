import { Data } from "effect";

/**
 * A terminal could not be started, or there was nothing to start.
 *
 * Its own error, rather than a reuse of the ones already here, because the
 * existing vocabulary has no slot for "the row is fine and there is still
 * nothing to run" — `InvalidPathError` is about a path, `ProviderError` is a
 * CLI's own words, and 404 would say the session does not exist when it plainly
 * does. Routes map `already running` to 409, `no handle` to 422 and
 * `spawn failed` to 500.
 */
export class TerminalError extends Data.TaggedError("TerminalError")<{
	readonly sessionId: string;
	readonly reason: "already running" | "no handle" | "spawn failed";
	readonly detail?: string;
	readonly cause?: unknown;
}> {}
