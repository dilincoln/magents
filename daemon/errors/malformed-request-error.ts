import { Data } from "effect";

/** The request body was not what the route asked for. */
export class MalformedRequestError extends Data.TaggedError(
	"MalformedRequestError",
)<{
	readonly reason: string;
}> {}
