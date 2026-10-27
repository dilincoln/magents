import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import type { ServerWebSocket } from "bun";
import { Effect, Runtime } from "effect";
import { ServerError } from "../errors/server-error";
import { socketPath } from "../paths/socket-path";
import { handleRequest } from "../routes/handle-request";
import type { Database } from "./database";
import { type AttachData, Terminals } from "./terminals";

/**
 * Brings up the listener and hands it back, closed when the scope ends.
 *
 * This is also what makes the daemon resident: a listening socket keeps the
 * event loop alive on its own, which is why the process used to exit and no
 * longer does.
 *
 * `Effect.runtime` captures the services this effect already has, so a request
 * handler — a plain async function, called by Bun, outside any Effect — can run
 * an effect that needs the database. The alternative is a second connection,
 * and two writers on one SQLite file is exactly what the daemon exists to avoid.
 *
 * The socket callbacks below take the same bridge one step further and then
 * stop: `Terminals` is resolved once, here, and the handlers close over the
 * plain object rather than running an effect each time. They are called by Bun
 * on every keystroke and every chunk a PTY produces, and building a fiber to
 * reach a Map at that rate would be an absurd price for nothing — which is why
 * the service hands out plain methods in the first place.
 *
 * The stale socket is removed before binding rather than after exiting: a
 * daemon killed with SIGKILL never runs its release, and the leftover file
 * makes the next start fail with `EADDRINUSE` on a socket nobody is listening
 * to. Cleaning up on the way in is the only version that survives a crash — and
 * it is only safe because `socketInUse` has already established that nobody is
 * on the other end of it.
 */
export const startServer = Effect.gen(function* () {
	const runtime = yield* Effect.runtime<Database | Terminals>();
	const run = Runtime.runPromise(runtime);
	const terminals = yield* Terminals;

	return yield* Effect.acquireRelease(
		Effect.try({
			try: () => {
				mkdirSync(dirname(socketPath), { recursive: true });
				// debris, not somebody's listener: the boot refused to get this far
				// if anything answered on it
				rmSync(socketPath, { force: true });

				return Bun.serve({
					unix: socketPath,
					fetch: (request, server) => run(handleRequest(request, server)),
					websocket: {
						// An attached client is quiet for as long as its agent is
						// thinking, which is minutes. This is scoped to upgraded
						// connections and measurably does not touch the server's own
						// timeout, which is what makes the whole transport affordable:
						// every JSON route keeps its default.
						idleTimeout: 0,
						maxPayloadLength: 16 * 1024 * 1024,
						open: (ws: ServerWebSocket<AttachData>) => terminals.attach(ws),
						message: (ws: ServerWebSocket<AttachData>, message) =>
							terminals.message(ws, message),
						close: (ws: ServerWebSocket<AttachData>) => terminals.detach(ws),
						drain: (ws: ServerWebSocket<AttachData>) => terminals.drain(ws),
					},
				});
			},
			catch: (cause) => new ServerError({ cause }),
		}),
		(server) =>
			// The release removes nothing. It used to `rmSync(socketPath)`
			// unconditionally, which is a daemon deleting whatever file happens to
			// be at that path — including a *different*, still-running daemon's
			// socket, leaving the survivor holding every live agent and reachable
			// by nothing but SIGTERM. Bun's own `stop` unlinks the path either way
			// (measured: after A.stop(true), B's socket file — a different inode —
			// was gone and B was unreachable), so the single-instance guard on the
			// way in is the actual fix and this line was never anything but a
			// second copy of the hazard.
			Effect.promise(() => server.stop(true)),
	);
});

/**
 * Whether a daemon already holds the socket.
 *
 * Asked before the boot does anything else, and it is not politeness. The sweep
 * that runs at startup reads every row with a pid, finds the *running* daemon's
 * children alive — `isStill` says true because they genuinely are — and
 * group-SIGTERMs the lot; the unlink above then takes the socket as well.
 * Measured: booting a second daemon on one MAGENTS_HOME printed
 * `orphans 1 signalled` and the first daemon's agent was gone. Nothing else in
 * the design makes single-instance an invariant, and the pid column's whole
 * doctrine — "the daemon running right now spawned this" — silently assumes it.
 *
 * A connect rather than a `GET /health`, because the question is whether anyone
 * is on the other end and a daemon wedged badly enough not to answer HTTP is
 * still a daemon holding every agent. Measured: connecting to an absent path and
 * to a stale socket file both throw `Failed to connect`, and to a live listener
 * succeeds, which is exactly the line between debris and a daemon.
 *
 * The window between this and the bind is real and unclosed. Two daemons started
 * in the same millisecond can still both get through; two started by a person in
 * two terminals cannot, and that is the case this exists for.
 */
export const socketInUse = async (): Promise<boolean> => {
	try {
		// the empty handler object is refused outright — `Expected at least "data"
		// or "drain" callback`, measured — and a probe that throws for that reason
		// reads as "nothing is listening", which is the one answer this must never
		// give wrongly
		const probe = await Bun.connect({
			unix: socketPath,
			socket: { data() {} },
		});
		probe.end();
		return true;
	} catch {
		return false;
	}
};
