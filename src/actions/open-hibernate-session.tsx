import type { Session } from "../../daemon/db/schema";
import { ConfirmHibernateSession } from "../components/confirm-hibernate-session";
import { useModalStore } from "../store/use-modal-store";

/** Asks before stopping a session's agent. The session itself stays. */
export function openHibernateSession(session: Session): void {
	useModalStore.getState().openModal({
		title: "hibernate session",
		hint: "enter hibernate",
		width: 60,
		children: (close) => (
			<ConfirmHibernateSession session={session} onClose={close} />
		),
	});
}
