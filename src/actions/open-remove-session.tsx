import type { Session } from "../../daemon/db/schema";
import { ConfirmRemoveSession } from "../components/confirm-remove-session";
import { useModalStore } from "../store/use-modal-store";

/** Asks before forgetting a session. */
export function openRemoveSession(session: Session): void {
	useModalStore.getState().openModal({
		title: "remove session",
		hint: "enter remove",
		width: 60,
		children: (close) => (
			<ConfirmRemoveSession session={session} onClose={close} />
		),
	});
}
