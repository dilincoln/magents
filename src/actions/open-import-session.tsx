import { ImportSessionForm } from "../components/import-session-form";
import { useAppStore } from "../store/use-app-store";
import { useModalStore } from "../store/use-modal-store";

/**
 * Spawns the form that brings in a session started outside magents.
 *
 * Wide enough for a UUID and the ends of the sentence under it. The field holds
 * thirty-six characters and the hint is the longest line in the panel.
 */
const WIDTH = 62;

export function openImportSession(): void {
	// the search has to let go first: two focused inputs is one too many, and the
	// keys would go to whichever the renderer happens to ask
	useAppStore.getState().focusRoster();

	useModalStore.getState().openModal({
		title: "import session",
		width: WIDTH,
		children: (close) => <ImportSessionForm onClose={close} />,
	});
}
