import { Effect, Option } from "effect";
import type { TerminalError } from "../errors/terminal-error";
import type { Database } from "../services/database";
import { startTerminal } from "../services/start-terminal";
import type { Terminals } from "../services/terminals";

/**
 * `POST /sessions/:id/terminal` — run this session's agent again.
 *
 * The only spawn path other than opening a session, and the answer to two
 * different things: a client that attached to a session which has never run,
 * and someone explicitly restarting one that ended. Attaching never starts
 * anything by itself, so this is where a restart is asked for out loud.
 *
 * The three refusals are three different situations and get three codes: a
 * session already has a process (409), the row is fine and there is nothing to
 * run (422), or the CLI would not start (500). A 404 is kept for the one thing
 * it means — no such row.
 */
export const postSessionTerminal = (
	id: string,
): Effect.Effect<Response, never, Database | Terminals> =>
	startTerminal(id).pipe(
		Effect.map(
			Option.match({
				onNone: () =>
					Response.json({ error: "no such session" }, { status: 404 }),
				onSome: (session) => Response.json(session),
			}),
		),
		Effect.catchTags({
			TerminalError: (error) =>
				Effect.succeed(
					Response.json(
						{ error: error.detail ?? error.reason },
						{ status: status(error) },
					),
				),
			// the provider's own words, the same as everywhere else it is asked
			ProviderError: (error) =>
				Effect.succeed(Response.json({ error: error.reason }, { status: 502 })),
			DatabaseError: (error) =>
				Effect.succeed(
					Response.json(
						{ error: `${error.operation} failed` },
						{ status: 500 },
					),
				),
		}),
	);

const status = (error: TerminalError): number => {
	if (error.reason === "already running") return 409;
	if (error.reason === "no handle") return 422;
	return 500;
};
