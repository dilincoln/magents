import type { Group } from "../../daemon/db/schema";
import { ConfirmRemoveGroup } from "../components/confirm-remove-group";
import { useModalStore } from "../store/use-modal-store";

/** Asks before dropping a group. Its sessions are not at stake; the panel says so. */
export function openRemoveGroup(group: Group, count: number): void {
	useModalStore.getState().openModal({
		title: "remove group",
		hint: "enter remove",
		width: 60,
		children: (close) => (
			<ConfirmRemoveGroup group={group} count={count} onClose={close} />
		),
	});
}
