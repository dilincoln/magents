import type { Project } from "../../daemon/db/schema";
import { AddGroupForm } from "../components/add-group-form";
import { useAppStore } from "../store/use-app-store";
import { useModalStore } from "../store/use-modal-store";

/** Spawns the form that makes a bucket in a project. */
export function openAddGroup(project: Project): void {
	// the search has to let go first: two focused inputs is one too many, and the
	// keys would go to whichever the renderer happens to ask
	useAppStore.getState().focusRoster();

	useModalStore.getState().openModal({
		title: "new group",
		hint: "⌃f default · ⌃z hibernate",
		width: 54,
		children: (close) => <AddGroupForm project={project} onClose={close} />,
	});
}
