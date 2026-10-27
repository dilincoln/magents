import type { Session } from "../../daemon/db/schema";
import { RenameSessionForm } from "../components/rename-session-form";
import { useAppStore } from "../store/use-app-store";
import { useModalStore } from "../store/use-modal-store";

/** Wide enough for a sentence, which is what most of these names are. */
const WIDTH = 62;

/** Opens the box that renames a session. */
export function openRenameSession(session: Session): void {
	// the search has to let go first: two focused inputs is one too many, and the
	// keys would go to whichever the renderer happens to ask
	useAppStore.getState().focusRoster();

	useModalStore.getState().openModal({
		title: "rename session",
		width: WIDTH,
		children: (close) => (
			<RenameSessionForm session={session} onClose={close} />
		),
	});
}
