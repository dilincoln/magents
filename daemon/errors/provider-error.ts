import { Data } from "effect";

/**
 * A provider's CLI could not be asked. Its own words are carried in `reason`,
 * because they are almost always the useful ones — "Missing optional
 * dependency @openai/codex-linux-x64" tells the user what to do, and any
 * sentence we invent to replace it would not.
 */
export class ProviderError extends Data.TaggedError("ProviderError")<{
	readonly provider: string;
	readonly reason: string;
	readonly cause?: unknown;
}> {}
