import type { LiveSession as Session } from "../../daemon/services/terminals";
import { MoveSessionForm } from "../components/move-session-form";
import { useAppStore } from "../store/use-app-store";
import { useModalStore } from "../store/use-modal-store";

/** Opens the list of buckets a session could sit in. */
export function openMoveSession(session: Session): void {
	// the search has to let go first: the list below answers ↑↓ and enter, and
	// so does the search field
	useAppStore.getState().focusRoster();

	useModalStore.getState().openModal({
		title: "move session",
		hint: "↑↓ pick · enter move",
		width: 54,
		children: (close) => <MoveSessionForm session={session} onClose={close} />,
	});
}
