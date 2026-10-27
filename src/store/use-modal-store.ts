/**
 * Modals are spawned, not declared. Nothing renders `<SomeModal />` and holds a
 * boolean for it — a call site describes the modal it wants and hands it over.
 */
import type { ReactNode } from "react";
import { create } from "zustand";

export interface ModalSpec {
	title: string;
	/**
	 * Given the function that closes this modal. Whatever the content puts that
	 * on — a button, a shortcut, a click — closes it, and the content never has
	 * to reach into the store to do it.
	 */
	children: (close: () => void) => ReactNode;
	/** the keys that work in here, shown along the bottom edge */
	hint?: string;
	width?: number;
	/**
	 * Paints the whole screen behind the panel. Left out, the screen stays
	 * visible around it. A colour, never a translucent one: `opacity` on the
	 * backdrop is inherited by the panel and the screen shows through the dialog.
	 */
	backdrop?: string;
}

interface ModalState {
	/** One at a time. Its presence *is* the open flag; there is no second field. */
	modal: ModalSpec | null;
	/**
	 * Whether the modal is in the middle of something that cannot be called off.
	 *
	 * Set by the content, because the content is the only thing that knows. A
	 * form waiting on a request it cannot recall — an import that has already
	 * asked claude to fork — has no honest way out to offer: closing the panel
	 * would not stop the work, it would only stop you finding out how it went.
	 * So the ways out are taken away rather than left there doing nothing.
	 *
	 * It gates the two the user reaches for, and only those. `closeModal` itself
	 * still works, because that is how the content closes itself when the thing
	 * it was waiting for is done.
	 */
	locked: boolean;
	openModal: (spec: ModalSpec) => void;
	lockModal: (locked: boolean) => void;
	closeModal: () => void;
}

export const useModalStore = create<ModalState>((set) => ({
	modal: null,
	locked: false,
	// a fresh modal is never born busy, and inheriting the last one's lock is the
	// kind of bug that only shows up after an import
	openModal: (spec) => set({ modal: spec, locked: false }),
	lockModal: (locked) => set({ locked }),
	closeModal: () => set({ modal: null, locked: false }),
}));
