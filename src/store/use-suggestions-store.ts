/**
 * Whether a suggestion picker is open somewhere on the screen.
 *
 * A global for something a component owns, which needs justifying: the keyboard
 * is global. An open picker holds `↑` `↓` `enter` `tab` and `esc`, and `esc` is
 * the one that matters — without this the screen would close the modal the
 * picker is inside, on the same keystroke that was meant to dismiss the picker.
 *
 * So it goes where the rest of the keyboard precedence already lives, in
 * `keyboard-owner.ts`, rather than being a special case wired through props.
 */
import { create } from "zustand";

interface SuggestionsState {
	open: boolean;
	setOpen: (open: boolean) => void;
}

export const useSuggestionsStore = create<SuggestionsState>((set) => ({
	open: false,
	setOpen: (open) => set({ open }),
}));
