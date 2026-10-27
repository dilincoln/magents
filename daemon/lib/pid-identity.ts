import { readFileSync } from "node:fs";

/**
 * Which process a pid means, so a stale one can be told apart from a stranger.
 *
 * A pid is not a handle. The kernel reuses the number, and by the time a daemon
 * boots and reads one off a row the process that wore it may have been gone for
 * days with something else — a `claude` the user started by hand — wearing it
 * now. Field 22 of `/proc/<pid>/stat` is that process's start time in clock
 * ticks since boot, and the kernel never reissues the same pair while the
 * machine is up, so pid plus start time is an identity where the pid alone is a
 * guess. This is the whole difference between a reaper that kills our orphan
 * and one that SIGTERMs somebody's work.
 *
 * Linux only, by construction. Everywhere else `startedAt` is null, `isStill`
 * is false, and the reaper stands down rather than signalling a number it
 * cannot vouch for.
 */

/** Null when there is no such process, or no `/proc` to ask. */
export const startedAt = (pid: number): number | null => {
	let stat: string;

	try {
		stat = readFileSync(`/proc/${pid}/stat`, "utf8");
	} catch {
		return null;
	}

	// Field 2 is the executable name in parentheses and the kernel does not
	// escape it: a process named `sh) 1 2 3 (x` is legal and would move every
	// column an offset from the left thinks it has found. Everything after the
	// last ")" is numbers, so that is the only safe place to start counting.
	const fields = stat
		.slice(stat.lastIndexOf(")") + 1)
		.trim()
		.split(/\s+/);

	// the first of those is field 3, so field 22 is nineteen along
	const ticks = Number(fields[19]);

	return Number.isFinite(ticks) ? ticks : null;
};

/**
 * Whether the pid still belongs to the process that was written down.
 *
 * False when `was` is null — a row from a host without `/proc`, or one written
 * before the column existed. The caller kills whatever this says is ours, so a
 * maybe has to answer no.
 */
export const isStill = (pid: number, was: number | null): boolean =>
	was !== null && startedAt(pid) === was;
