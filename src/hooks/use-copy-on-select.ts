import { CliRenderEvents, type Selection } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { useEffect } from "react";
import { copyText, installClipboard } from "../lib/copy";
import { flashCopied } from "../store/use-copy-flash";

/**
 * Selecting is copying, the way it is in claude code: let go of the mouse and
 * whatever is highlighted is on the clipboard, no chord to remember.
 *
 * The renderer emits `selection` exactly once per drag, on the mouse-up — not
 * per movement — so this is one copy per selection, not sixty a second. A bare
 * click arrives as a selection of nothing and is ignored, which is what keeps
 * ordinary clicking around the roster from blanking the clipboard.
 */
export function useCopyOnSelect(): void {
	const renderer = useRenderer();

	useEffect(() => {
		installClipboard(renderer);

		const finished = (selection: Selection | null): void => {
			if (!selection) return;

			// a click, not a sweep: nothing was swept, nothing is copied. The pane
			// paints nothing for a zero-width selection either (see
			// `PaneTerminalRenderable`), so there is nothing to clear here.
			const { anchor, focus } = selection;
			if (anchor.x === focus.x && anchor.y === focus.y) return;

			const text = selection.getSelectedText().trim();
			if (!text) return;
			copyText(text);
			flashCopied();
		};

		renderer.on(CliRenderEvents.SELECTION, finished);
		return () => {
			renderer.off(CliRenderEvents.SELECTION, finished);
		};
	}, [renderer]);
}
