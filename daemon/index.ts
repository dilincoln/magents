/**
 * The daemon. It owns the database — one writer, so nothing has to arbitrate —
 * it owns every agent's terminal, and it answers over a unix socket in
 * `~/.magents`.
 *
 * It used to stay up because the socket kept it up: no timer, no signal
 * handler, the listener the only reason the process was alive and closing it
 * the whole of ending. That was honest while the daemon was a request handler
 * and became a lie the moment it took the PTYs. SIGTERM's default action ends
 * the process where it stands, so nothing was released — the fd went back to
 * the OS, the socket file was left for the next boot to find (which is why the
 * boot probes it and only removes it when nothing answers), and the agents were
 * hung up on by the kernel. Being hung up on is not a shutdown. The program now
 * waits to be told to stop and completes normally when it is, because a normal
 * completion is the only thing that closes the scope and kills the children on
 * purpose.
 *
 * The scope closes LIFO, so the way out is the reverse of the way in: listener,
 * then terminals, then database. That costs something real and it is not worth
 * papering over — a client attached to an agent watches its socket drop before
 * the shutdown reaches the agent, so it gets a bare close rather than a
 * farewell, reconnects, fails, and hears from the heartbeat that the daemon is
 * gone. Reaping first would take a second scope wrapped around the listener's,
 * to buy one sentence in a pane that is about to be told anyway.
 */

import { Console, Effect, Layer } from "effect";
import { dbPath } from "./paths/db-path";
import { socketPath } from "./paths/socket-path";
import { claimDatabase, databaseHolder } from "./services/claim-database";
import { Database } from "./services/database";
import { listProjects } from "./services/list-projects";
import { listSessions } from "./services/list-sessions";
import { reconcileTerminals } from "./services/reconcile-terminals";
import { socketInUse, startServer } from "./services/start-server";
import { Terminals } from "./services/terminals";

/**
 * Waits to be told to stop.
 *
 * The first signal handling in the codebase, and a convention rather than a
 * patch: everything that has to be released now outlives the request that
 * created it, so the process needs an ending it can run code inside.
 * `process.once` rather than `on`, and removed again in the finalizer, so a
 * scope that closed for some other reason leaves no handler behind holding a
 * resume nobody is ever going to call.
 */
const untilSignal = Effect.async<void>((resume) => {
	const stop = () => resume(Effect.void);

	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);

	return Effect.sync(() => {
		process.off("SIGINT", stop);
		process.off("SIGTERM", stop);
	});
});

export const daemon = Effect.gen(function* () {
	// Held for as long as this program runs, and taken before the sweep, which
	// is the dangerous part: until the sweep has run every pid on disk belongs
	// to a daemon that is already dead, and that premise is true only of the one
	// daemon the refusals above let through. A second one finds the first's
	// children alive and reaps them.
	yield* claimDatabase;

	// Before the listener answers anything, for the other half of the same
	// reason: a route that read a pid before the sweep would be reporting a
	// stranger's process as somebody's agent.
	yield* reconcileTerminals;

	yield* startServer;

	const projects = yield* listProjects;
	const sessions = yield* listSessions();

	yield* Console.log("magents daemon");
	yield* Console.log(`  db        ${dbPath}`);
	yield* Console.log(`  socket    ${socketPath}`);
	yield* Console.log(`  projects  ${projects.length}`);
	yield* Console.log(`  sessions  ${sessions.length}`);
	yield* Console.log("  listening — ctrl-c to stop");

	// Serving is not a thing that finishes. Being asked to stop is, and it is
	// the only thing that finishes this: without it the effect completes, the
	// scope closes, and the release takes the listener and every agent with it.
	yield* untilSignal;
	yield* Console.log("  stopping");
});

if (import.meta.main) {
	/*
	 * Two refusals, before the database is opened and long before the sweep runs.
	 *
	 * The socket is asked first only because it gives the better sentence: if
	 * something answers there, the daemon that is running is one this user can
	 * reach and stop. It is not the guard that matters. It keys on the socket
	 * path while the hazard keys on the database, and `MAGENTS_SOCKET` and
	 * `MAGENTS_DB` are separate overrides — a second daemon on one home with a
	 * socket of its own sails past this and reaps every agent the first one
	 * owns, which is exactly what was measured before the lock existed.
	 */
	if (await socketInUse()) {
		console.error(`a magents daemon is already listening on ${socketPath}`);
		console.error("  stop that one first — a second would kill its agents");
		process.exit(1);
	}

	const holder = databaseHolder();
	if (holder !== null) {
		console.error(`a magents daemon (pid ${holder}) already holds ${dbPath}`);
		console.error("  stop that one first — a second would kill its agents");
		process.exit(1);
	}

	// `Terminals` needs `Database`, so the two go up together with `provideMerge`
	// and not `merge` — merged side by side, `Database` stays an unsatisfied
	// requirement and `runPromise` is what refuses the program (measured: `Type
	// 'Database' is not assignable to type 'never'`). That is the entire
	// objection to `merge` here, and not, as it reads, a second connection:
	// layers are memoized by reference within one build, so either wiring would
	// have opened exactly one database.
	await Effect.runPromise(
		daemon.pipe(
			Effect.scoped,
			Effect.provide(Layer.provideMerge(Terminals.Default, Database.Default)),
		),
	);

	// Every release has run by here, so this is a net and not the mechanism: a
	// live PTY child refs Bun's event loop, and a shutdown that missed one would
	// otherwise hang at the very end rather than say so.
	process.exit(0);
}
