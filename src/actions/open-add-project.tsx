import { AddProjectForm } from "../components/add-project-form";
import { useAppStore } from "../store/use-app-store";
import { useModalStore } from "../store/use-modal-store";

/** Spawns the form that registers a repository with the daemon. */
export function openAddProject(): void {
	// the search has to let go first: two focused inputs is one too many, and the
	// keys would go to whichever the renderer happens to ask
	useAppStore.getState().focusRoster();

	useModalStore.getState().openModal({
		title: "add project",
		hint: "↑↓ pick · tab complete",
		width: 62,
		children: (close) => <AddProjectForm onClose={close} />,
	});
}
