import { useEffect, useRef } from "react";
import { setAttention } from "../../client/set-attention";
import { queryClient } from "../queries/query-client";
import { sessionsQuery } from "../queries/sessions-query";
import { useSelectedRow } from "../store/use-app-store";

/**
 * Puts a row's light out once the cursor is on it.
 *
 * This is the whole definition of "seen", and it is deliberately the cheapest
 * one that is true. Attaching is too strong — you can tell an agent has
 * finished without typing at it — and merely being on screen is too weak, since
 * every row is. The cursor is the one thing that says which session the person
 * is dealing with, and moving it there is the act of dealing with it.
 *
 * Told to the daemon rather than kept here, because the flag is stored: another
 * TUI on the same daemon has the same row lit and has to stop too.
 *
 * The guard is an *in flight* marker and nothing more. The write and the refetch
 * that clears the flag are two round trips, and for the beat and a half between
 * them this effect can see a selected session that still says it wants
 * attention — so without the set it would ask again, and a cursor left on the
 * row would send a request a frame.
 *
 * Which is why the id comes back out when the round trip ends, however it ends.
 * It used to come out only when the write failed, and the effect of that was a
 * session that could be dismissed exactly once per run of the TUI: the second
 * time it lit up — the same agent finishing its next turn — the guard was still
 * holding an id from minutes ago and the row stayed lit until magents was
 * restarted. A marker for something in flight has to be dropped when the thing
 * lands.
 *
 * The pause before it is a correction, and it came out of watching this work:
 * arrowing down a list runs this on every row the cursor crosses, so a sweep
 * past a lit row put it out without anybody having read anything. Landing on a
 * row and moving on is not looking at it. A third of a second is the difference
 * between the two, and it is short enough that stopping *is* the whole gesture
 * — nobody waits for this.
 */

/** How long the cursor has to stay before the row counts as read. */
const DWELL_MS = 350;
export function useSeenSession(): void {
	const row = useSelectedRow();
	const asked = useRef(new Set<string>());

	const id = row?.kind === "session" ? row.session.id : null;
	const wants = row?.kind === "session" && row.session.requiresAttention;

	useEffect(() => {
		if (!id || !wants || asked.current.has(id)) return;

		const dwell = setTimeout(() => {
			asked.current.add(id);

			setAttention({ id, requiresAttention: false })
				.then(() =>
					queryClient.invalidateQueries({ queryKey: sessionsQuery.queryKey }),
				)
				.catch(() => {
					// A daemon that would not answer is one the status dot is already
					// saying something about, and this is the least of what is wrong.
				})
				.finally(() => {
					/*
					 * Both ways out, which is the fix: a successful clear used to keep
					 * the id forever and the row could never be dismissed again.
					 *
					 * By the time this runs the refetch has landed — measured, and it
					 * holds because the roster is watching this query; `invalidateQueries`
					 * only waits on a refetch it actually started, and with no observer
					 * it resolves the moment it has marked the data stale. Neither order
					 * can loop, and that is worth being clear about, because letting the
					 * id go while the row might still say it wants attention sounds like
					 * it should: the effect re-runs on `wants` changing, not on this ref,
					 * so releasing early arms nothing. It only means the next honest
					 * change of that flag is answered.
					 */
					asked.current.delete(id);
				});
		}, DWELL_MS);

		return () => clearTimeout(dwell);
	}, [id, wants]);
}
