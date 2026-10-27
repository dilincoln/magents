import { useKeyboard } from "@opentui/react";
import { useMemo, useState } from "react";
import { isDirectory } from "../lib/is-directory";
import { type DirEntry, listDirectory } from "../lib/list-directory";

export interface PathCompletion {
	/** the directories the current path could mean */
	entries: DirEntry[];
	/** the row enter would take, or null when enter belongs to the form */
	highlight: number | null;
	/** Enter, answered. `true` means a row was taken and this was not a submit. */
	takeEnter: () => boolean;
}

/**
 * The list under a path field, and the keys that move through it.
 *
 * This owns the highlight rather than the list component, because **one thing
 * has to decide what enter means**. A `<input onSubmit>` fires on enter no
 * matter what else is on the screen, so a picker that answered enter on its own
 * would complete *and* submit — which it did, and submitting a half-typed path
 * is exactly the refusal the picker exists to prevent.
 *
 * The rule is one line and it is visible on the screen: **enter takes the
 * highlighted row, and there is a highlighted row exactly when the field is not
 * already an answer.**
 *
 * - typing a partial name → the first match is highlighted, enter takes it
 * - the field names a real directory → nothing is highlighted, enter adds it
 * - arrowing into the list → that row is highlighted, enter takes it
 *
 * So the highlight is a promise about the next enter, and it is kept. The
 * version before this highlighted the first row always, including when enter
 * would submit — a row that looked chosen while enter ignored it.
 */
export function usePathCompletion(
	path: string,
	onPick: (path: string) => void,
): PathCompletion {
	const entries = useMemo(() => listDirectory(path), [path]);

	const [moved, setMoved] = useState<number | null>(null);
	const [shownFor, setShownFor] = useState(path);

	// A new path is a new list, and an index left over from the old one would sit
	// on whatever happens to occupy that slot now. Adjusted during render rather
	// than in an effect: there is no frame in between where the highlight is on
	// the wrong row.
	if (shownFor !== path) {
		setShownFor(path);
		setMoved(null);
	}

	const highlight =
		moved ?? (entries.length === 0 || isDirectory(path) ? null : 0);

	const take = (index: number): boolean => {
		const entry = entries[index];
		if (!entry) return false;
		onPick(entry.path);
		return true;
	};

	useKeyboard((key) => {
		if (entries.length === 0) return;

		if (key.name === "up" || key.name === "down") {
			const delta = key.name === "down" ? 1 : -1;
			// from nothing, down enters at the top and up enters at the bottom
			setMoved(
				highlight === null
					? delta > 0
						? 0
						: entries.length - 1
					: (highlight + delta + entries.length) % entries.length,
			);
		}

		// tab completes whether or not a row is highlighted, the way it does in a
		// shell: there is always a first match, and tab is asking for it
		if (key.name === "tab") take(highlight ?? 0);
	});

	return {
		entries,
		highlight,
		takeEnter: () => highlight !== null && take(highlight),
	};
}
