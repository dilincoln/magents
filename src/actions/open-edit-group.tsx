import type { Group } from "../../daemon/db/schema";
import { EditGroupForm } from "../components/edit-group-form";
import { useAppStore } from "../store/use-app-store";
import { useModalStore } from "../store/use-modal-store";

/** Opens the box that changes a group. */
export function openEditGroup(group: Group): void {
	// the search has to let go first: two focused inputs is one too many, and the
	// keys would go to whichever the renderer happens to ask
	useAppStore.getState().focusRoster();

	useModalStore.getState().openModal({
		title: "edit group",
		width: 54,
		children: (close) => <EditGroupForm group={group} onClose={close} />,
	});
}
