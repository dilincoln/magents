import { Data } from "effect";

/** The listener would not come up — socket in use, directory not writable. */
export class ServerError extends Data.TaggedError("ServerError")<{
	readonly cause: unknown;
}> {}
