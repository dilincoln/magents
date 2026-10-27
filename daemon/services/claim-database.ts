import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Effect } from "effect";
import { isStill, startedAt } from "../lib/pid-identity";
import { dbPath } from "../paths/db-path";

/**
 * One daemon per database, made true rather than assumed.
 *
 * The pid column's whole doctrine is that a non-null value means "the daemon
 * running right now spawned this and has not seen it end", and the boot sweep
 * is what earns that sentence: it signals every pid it finds and then clears
 * the column unconditionally. Both halves are correct for the only daemon and
 * catastrophic for a second one, which finds the first daemon's children alive,
 * decides they are orphans of a crash, and SIGTERMs every agent on the machine.
 * Measured, twice, before this file existed.
 *
 * `socketInUse` was the first answer and is not enough. It keys on the socket
 * path; the hazard keys on the database, and `MAGENTS_SOCKET` and `MAGENTS_DB`
 * are independent overrides — two daemons on one home with different sockets is
 * a supported configuration that quietly wiped the first one's work. The lock
 * belongs beside the thing at risk, so it sits beside the database file.
 *
 * A pid alone in the file would be a worse lie than none: the number is reused,
 * so a lock left by a SIGKILLed daemon would eventually name somebody's editor
 * and refuse every boot until it was deleted by hand. It carries the start time
 * too, and `isStill` is what tells our holder from a stranger — the same pair,
 * for the same reason, as the rows this is protecting.
 */
const lockPath = `${dbPath}.lock`;

/** The live daemon holding this database, or null if nobody does. */
export const databaseHolder = (): number | null => {
	let held: string;

	try {
		held = readFileSync(lockPath, "utf8");
	} catch {
		return null;
	}

	const [pid, since] = held.trim().split(/\s+/).map(Number);

	// A lock we cannot parse is debris from a version that wrote it differently,
	// and debris is not a holder. Refusing to boot on an unreadable file would
	// make the safety mechanism the outage.
	if (pid === undefined || !Number.isFinite(pid)) return null;

	const was = since !== undefined && Number.isFinite(since) ? since : null;
	return isStill(pid, was) ? pid : null;
};

/**
 * Takes the lock for as long as the scope lives.
 *
 * Written after the caller has already refused on `databaseHolder`, so this
 * overwrites without asking: whatever is on disk at this point is either
 * nothing or the remains of a daemon that is provably gone. The gap between the
 * two is a race in principle and the file is not an arbitrator — two daemons
 * started in the same millisecond would both pass. It is one user and one
 * machine, and the honest version of this guard is a check that is right every
 * time somebody starts a second daemon and wrong only if they start two at
 * once, which is not the mistake anybody makes.
 */
export const claimDatabase = Effect.acquireRelease(
	Effect.sync(() => {
		mkdirSync(dirname(lockPath), { recursive: true });
		writeFileSync(lockPath, `${process.pid} ${startedAt(process.pid) ?? ""}\n`);
	}),
	() => Effect.sync(() => rmSync(lockPath, { force: true })),
);
