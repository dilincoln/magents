import { create } from "zustand";

/** Where the split starts, and what it was before it could be moved. */
export const DEFAULT_WIDTH = 30;

/**
 * Narrow enough to be a list of names and no narrower.
 *
 * Below this the roster's title column goes to single figures and every row is
 * an ellipsis, which is a sidebar that costs space and says nothing. Somebody
 * who wants it gone wants it gone rather than narrow.
 */
const MIN_WIDTH = 22;

/**
 * What the pane on the right is never allowed to shrink past.
 *
 * Forty and not eighty, which is what this was first and what made the feature
 * useless: eighty is where CLI output stops wrapping and it is a fine thing to
 * want, but as a floor it meant a hundred-column terminal could not widen the
 * sidebar by a single column. A floor is not the place to express a preference.
 * This one is the narrowest a terminal can be and still be one.
 */
const MIN_PANE = 40;

/**
 * The width, within what the terminal can actually give.
 *
 * Both bounds in one place and every caller made to supply the terminal's own
 * width, because there is no honest maximum without it: a ceiling that ignored
 * the screen would let the sidebar push the agent off the edge of it.
 *
 * Two ceilings, and the lower wins. Half the screen is a shape rule — a list of
 * names outgrowing the thing it is a list *of* is not a layout anybody meant to
 * ask for — and `MIN_PANE` is the hard one underneath it, which only bites on a
 * screen too narrow for halves to matter.
 *
 * The floor beats both when they collide. On a terminal too narrow for any of
 * this the list gets its minimum and the pane takes what is left, because a
 * sidebar that vanishes on a small screen is a worse answer than a tight one.
 */
export const clampWidth = (width: number, available: number): number => {
	const ceiling = Math.max(
		MIN_WIDTH,
		Math.min(Math.round(available / 2), available - MIN_PANE),
	);

	return Math.round(Math.max(MIN_WIDTH, Math.min(ceiling, width)));
};

interface SidebarState {
	width: number;
	/**
	 * Whether the sidebar is on screen at all, which `⌃e` flips.
	 *
	 * Hidden rather than narrowed to nothing: `MIN_WIDTH` is a floor on purpose,
	 * and somebody who wants the agent to have the whole screen wants the list
	 * gone, not a sliver of it. The width is kept while it is away, so it comes
	 * back the size it left.
	 *
	 * What it costs is the one place a session asking for attention is seen —
	 * which is why the footer takes that job over while this is false.
	 */
	visible: boolean;
	/**
	 * Whether a drag that started on the handle is still going.
	 *
	 * It lives here rather than in the handle because the handle is one column
	 * wide and a drag leaves it immediately. What follows the pointer is the box
	 * that contains both panes — every drag inside it bubbles up whoever the
	 * renderer captured — and this is how that box knows the drag is a resize
	 * rather than someone selecting text in a terminal.
	 */
	resizing: boolean;

	/** `available` is the terminal's width; see `clampWidth`. */
	setWidth: (width: number, available: number) => void;
	nudge: (delta: number, available: number) => void;
	toggle: () => void;
	show: () => void;
	beginResize: () => void;
	endResize: () => void;
}

export const useSidebarStore = create<SidebarState>((set, get) => ({
	width: DEFAULT_WIDTH,
	visible: true,
	resizing: false,

	setWidth: (width, available) => set({ width: clampWidth(width, available) }),
	// brings it back too: a width changed on a sidebar nobody can see is a key
	// that seems to do nothing, and asking for a size is asking to look at it
	nudge: (delta, available) =>
		set({ width: clampWidth(get().width + delta, available), visible: true }),
	toggle: () => set({ visible: !get().visible }),
	show: () => set({ visible: true }),
	beginResize: () => set({ resizing: true }),
	endResize: () => set({ resizing: false }),
}));
