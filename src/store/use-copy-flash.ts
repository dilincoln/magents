import { create } from "zustand";

/**
 * Whether "✓ copied" is on the footer right now.
 *
 * A store for one boolean, because the two writers are nowhere near the
 * reader: the selection listener is a hook on the screen, the OSC 52
 * passthrough is not in React at all, and the footer just wants to know.
 */
export const useCopyFlash = create<{ shown: boolean }>(() => ({
	shown: false,
}));

let timer: ReturnType<typeof setTimeout> | undefined;

/** Shows the note, and takes it away after a moment of being read. */
export function flashCopied(): void {
	clearTimeout(timer);
	useCopyFlash.setState({ shown: true });
	timer = setTimeout(() => useCopyFlash.setState({ shown: false }), 1500);
}
