import type { Effect } from "effect";
import type { ProviderError } from "../errors/provider-error";
import type { Model } from "./model";
import type { ProviderId } from "./provider-id";
import type { FoundSession, Launch, SessionSpec } from "./session-spec";

/**
 * What the daemon needs from a provider, and nothing else.
 *
 * Three things now, and the split between them is the one the two providers
 * forced. `open` is where they differ and it is allowed to do work: claude
 * takes the id we hand it on a flag, codex takes it off a rollout we write
 * first. `resume` is where they agree — both take a handle and a directory —
 * so it is pure, and the screen calls it directly rather than asking the daemon
 * how to reattach to a session it already knows about.
 */
export interface ProviderAdapter {
	readonly id: ProviderId;
	/**
	 * Every model the provider will run, asked fresh. Nothing is cached here —
	 * caching is the client's job, where a query key can say when to let go.
	 */
	readonly listModels: Effect.Effect<Model[], ProviderError>;
	/**
	 * Brings a session into being and says how to attach to it. Effectful
	 * because for one provider it is: minting the id means running the CLI.
	 */
	readonly open: (spec: SessionSpec) => Effect.Effect<Launch, ProviderError>;
	/**
	 * The command that puts a terminal back on an existing session. Pure, and
	 * deliberately so — this is called every time a row is selected, on both
	 * sides of the socket, and a round trip to be told a fixed argv would be a
	 * round trip for nothing.
	 */
	readonly resume: (externalId: string, cwd: string) => string[];
	/**
	 * Environment the provider's CLI is run with, on top of the daemon's own.
	 *
	 * Not configuration and not user preference — this is for the settings that
	 * have to hold because of *where* the CLI is running. A provider started in
	 * one of our PTYs is inside a pane inside magents, and a feature of its that
	 * assumes it owns the terminal is a feature that will not work here.
	 *
	 * Left off by a provider with nothing to say, which is how it stays readable
	 * as the exception it is.
	 */
	readonly env?: Readonly<Record<string, string>>;
	/**
	 * How long to wait before putting a terminal on a session, in milliseconds.
	 *
	 * Zero for a provider that is ready when it says it is, which both are now.
	 * It stays a knob rather than a constant because codex was not, for a
	 * while: the `exec` that used to open a session was still finishing its
	 * write when it exited, and a `resume` that arrived too early found nothing
	 * to resume. A provider that is ready when it says it is can say zero.
	 */
	readonly attachDelayMs: number;
	/**
	 * Finds a conversation by the handle it already has.
	 *
	 * Not a session of ours: a handle we were given for one started in a
	 * terminal, by hand, that somebody now wants in the roster. What comes back
	 * says where it ran, because that is the one thing a handle alone does not.
	 *
	 * Null for "no such session", which is an answer and not a failure: a typo
	 * in a pasted id is the ordinary way to get here.
	 */
	readonly locate: (
		externalId: string,
	) => Effect.Effect<FoundSession | null, ProviderError>;
	/**
	 * Makes a session of our own out of one that is not, and answers with its
	 * new handle.
	 *
	 * Optional, and only claude has it. A conversation started in somebody's
	 * terminal may still be attached to something — `claude --bg` leaves one
	 * running — and claude refuses to resume a session twice rather than let two
	 * writers race over one transcript. `--fork-session` is the way out it
	 * offers: the history is copied into a new conversation with a new id, the
	 * original is left alone, and what comes back is a session nobody else holds.
	 *
	 * So this is not a lookup with a side effect. It creates something, it costs
	 * a turn, and it is why an imported claude row's handle is not the handle
	 * that was pasted in.
	 */
	readonly fork?: (
		externalId: string,
		cwd: string,
	) => Effect.Effect<string, ProviderError>;
}
