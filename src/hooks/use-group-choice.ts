import { useKeyboard } from "@opentui/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { Group } from "../../daemon/db/schema";
import { groupsQuery } from "../queries/groups-query";

const NONE: Group[] = [];

export interface GroupChoice {
	/** where the session will go, or null for no bucket at all */
	group: Group | null;
	/** how many places there are to put it, counting *none* — one needs no key */
	options: number;
	cycle: () => boolean;
}

/**
 * Which bucket a session is about to be opened into.
 *
 * Starts on the project's default, which is the whole point of having one, and
 * `⌃g` walks the rest — `⌃g` next to `⌃p`, `⌃o` and `⌃e`, a chord like its
 * neighbours so it survives being pressed in the middle of a word in the box
 * below.
 *
 * *None* is one of the places, at the end of the ring rather than at the front.
 * A project with a default has said where work goes, so opening the panel on
 * *none* would be ignoring the answer it just gave; a project without one has
 * nothing but *none*, and the key does not appear at all.
 *
 * Seeded when the list arrives rather than in `useState`, for the reason
 * `useModelSelection` is: the query answers a render or two after the panel
 * opens, and an initial value computed from an empty list is a default nobody
 * chose. Keyed by project so that it seeds once and a refetch returning the
 * same groups cannot move a selection the user has already made.
 */
export function useGroupChoice(projectId: string): GroupChoice {
	const all = useQuery(groupsQuery).data ?? NONE;
	const groups = all.filter((group) => group.projectId === projectId);

	// the ring: every bucket, then no bucket
	const options: (Group | null)[] = [...groups, null];

	const [index, setIndex] = useState(0);
	const [seededFor, setSeededFor] = useState<string | null>(null);

	if (seededFor !== projectId && groups.length > 0) {
		setSeededFor(projectId);
		const fallback = groups.findIndex((group) => group.isDefault);
		setIndex(fallback === -1 ? options.length - 1 : fallback);
	}

	const cycle = (): boolean => {
		if (options.length < 2) return false;
		setIndex((current) => (current + 1) % options.length);
		return true;
	};

	useKeyboard((key) => {
		if (!key.ctrl || key.name !== "g") return;
		if (!cycle()) return;

		key.preventDefault();
		key.stopPropagation();
	});

	return {
		// clamped rather than trusted: a group removed in another window shortens
		// the ring under an index that was valid a moment ago
		group: options[Math.min(index, options.length - 1)] ?? null,
		options: options.length,
		cycle,
	};
}
