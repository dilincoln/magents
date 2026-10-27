import type { Project } from "../../daemon/db/schema";
import { ConfirmRemoveProject } from "../components/confirm-remove-project";
import { useModalStore } from "../store/use-modal-store";

/** Asks before forgetting a project. */
export function openRemoveProject(project: Project): void {
	useModalStore.getState().openModal({
		title: "remove project",
		hint: "enter remove",
		width: 60,
		children: (close) => (
			<ConfirmRemoveProject project={project} onClose={close} />
		),
	});
}
