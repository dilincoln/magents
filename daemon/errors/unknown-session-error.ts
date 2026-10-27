import { Data } from "effect";

/**
 * A handle was offered and no provider has a conversation by that name.
 *
 * Its own error rather than a `ProviderError`, because nothing went wrong: both
 * providers were asked, both answered, and the answer was no. The ordinary way
 * to get here is a mistyped id, which is the caller's to fix and not the
 * daemon's to apologise for.
 */
export class UnknownSessionError extends Data.TaggedError(
	"UnknownSessionError",
)<{
	readonly externalId: string;
	readonly reason: string;
}> {}
