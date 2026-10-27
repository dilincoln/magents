import { isNotNull } from "drizzle-orm";
import { Console, Effect } from "effect";
import { sessions } from "../db/schema";
import { DatabaseError } from "../errors/database-error";
import { isStill } from "../lib/pid-identity";
import { Database } from "./database";

/**
 * What the last daemon left behind, dealt with before this one accepts anyone.
 *
 * A daemon that was SIGKILLed ran no release: its masters closed, the kernel
 * SIGHUPed the children, and the well-behaved ones died. The ones that ignore
 * HUP did not, and there is no fd, no parent and no signal left that reaches
 * them — only the pid on the row, which is the entire reason that column is on
 * disk rather than in the registry.
 *
 * `isStill` is what makes signalling it defensible. The number alone is a
 * guess; killing on a guess means SIGTERMing whichever stranger inherited it
 * while the daemon was down.
 *
 * The clear afterwards is unconditional — every row, whether it was signalled,
 * whether the process was still ours, whether there was a `/proc` to ask. That
 * is what buys the column its meaning for the rest of the run: a non-null pid
 * says "the daemon running right now spawned this and has not seen it end", and
 * nothing weaker would be worth reading.
 *
 * All of which is true of exactly one daemon and false of two. A live daemon's
 * children are still alive, so `isStill` says yes to every one of them and this
 * signals the lot — measured, a second boot on one MAGENTS_HOME printed
 * `orphans 1 signalled` and took the first daemon's agent with it. That is why
 * `socketInUse` runs before this does and the boot refuses rather than sweeps:
 * a crash leaves debris, but only the boot that established the socket is dead
 * is entitled to call any of it debris.
 */
export const reconcileTerminals: Effect.Effect<void, DatabaseError, Database> =
	Effect.gen(function* () {
		const { db } = yield* Database;

		const orphans = yield* Effect.try({
			try: () =>
				db.select().from(sessions).where(isNotNull(sessions.pid)).all(),
			catch: (cause) =>
				new DatabaseError({ operation: "reconcileTerminals/read", cause }),
		});

		let killed = 0;

		for (const row of orphans) {
			if (row.pid === null || !isStill(row.pid, row.pidStartedAt)) continue;

			try {
				process.kill(-row.pid, "SIGTERM");
				killed += 1;
			} catch {
				// gone between the read and the signal, or in a group we are not
				// allowed to signal; either way it is not ours to finish
			}
		}

		yield* Effect.try({
			try: () =>
				db.update(sessions).set({ pid: null, pidStartedAt: null }).run(),
			catch: (cause) =>
				new DatabaseError({ operation: "reconcileTerminals/clear", cause }),
		});

		if (killed > 0) yield* Console.log(`  orphans   ${killed} signalled`);
	});
