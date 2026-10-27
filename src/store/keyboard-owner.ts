import { type Focus, useAppStore } from "./use-app-store";
import { useModalStore } from "./use-modal-store";
import { useSuggestionsStore } from "./use-suggestions-store";

export type KeyboardOwner =
	| "suggestions"
	| "modal"
	| "search"
	| "roster"
	| "terminal";

/**
 * Who the keyboard belongs to right now.
 *
 * The precedence lives here and only here: a spawned modal outranks whatever
 * had the keyboard, and closing it hands the keyboard back rather than dumping
 * it on the roster — the search survives a modal opened on top of it.
 *
 * An open suggestion picker outranks even the modal, and for one key in
 * particular: `esc` dismisses the picker, and it must not also close the modal
 * the picker is sitting in. Dismissing a list and abandoning the form are
 * different intentions and they deserve different keystrokes.
 *
 * A focused terminal is the opposite case: it wants *every* key, `q` and `?`
 * and `esc` included, because they are being typed at a program that is not us.
 * It still ranks below a modal — a dialog opened over it is a question the
 * terminal cannot answer.
 */
const ownerOf = (
	focus: Focus,
	hasModal: boolean,
	suggesting: boolean,
): KeyboardOwner => (suggesting ? "suggestions" : hasModal ? "modal" : focus);

/** For key handlers, which run outside render. */
export const keyboardOwner = (): KeyboardOwner =>
	ownerOf(
		useAppStore.getState().focus,
		useModalStore.getState().modal !== null,
		useSuggestionsStore.getState().open,
	);

/** For components, which need to re-render when it changes. */
export const useKeyboardOwner = (): KeyboardOwner => {
	const focus = useAppStore((state) => state.focus);
	const hasModal = useModalStore((state) => state.modal !== null);
	const suggesting = useSuggestionsStore((state) => state.open);
	return ownerOf(focus, hasModal, suggesting);
};
