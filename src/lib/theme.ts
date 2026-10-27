/** The one palette for the whole app. Every color in the UI comes from here. */
export const theme = {
	// surfaces
	bg: "#0a0c14",
	panel: "#0d1020",
	line: "#1c2340",
	lineActive: "#2f3d6b",
	/**
	 * Under the pointer.
	 *
	 * One step up from `panel` and two below `lineActive`, on purpose: the mouse
	 * being somewhere and the cursor being somewhere are different facts, and the
	 * second is the one that decides what the keys do. A hover as bright as a
	 * selection would put two of them on screen at once and only one of them would
	 * be true.
	 */
	hover: "#1b2138",
	/**
	 * `panel` at two thirds, for laying over something that stays readable under
	 * it.
	 *
	 * Eight-digit hex, and the alpha is not decoration: the buffer blends it with
	 * whatever is beneath rather than covering it — measured, `#ff0000` under
	 * this resolves to `(97, 10, 21)`. Text drawn on top keeps its own opacity,
	 * which is the whole reason a veil can carry a sentence.
	 *
	 * It started at a third (`0x59`, which put that same red at `(171, 6, 11)`)
	 * and was too faint to read as a state. The ceiling is what is underneath
	 * still being legible: past roughly `0xbf` this stops being a veil and
	 * becomes a panel, and a panel would answer "you are not attached" by taking
	 * away the screen that is the reason to be here.
	 */
	veil: "#0d1020a6",

	// type
	text: "#dbe2f5",
	muted: "#6a739b",
	faint: "#3a4167",

	// ui accents
	accent: "#22d3ee",
	violet: "#a78bfa",
	ok: "#4ade80",
	warn: "#fbbf24",
	/**
	 * A row with something to say, washed over whatever is under it.
	 *
	 * The accent again rather than a colour of its own, because it means the
	 * same thing it means everywhere else here — this is the one to look at —
	 * and a fifth hue would be a fifth thing to learn. What distinguishes it is
	 * that it moves: see `attention-pulse.ts`, which supplies the alpha.
	 */
	attention: "#22d3ee",
} as const;

export type Theme = typeof theme;
