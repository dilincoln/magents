import type { Project } from "../../daemon/db/schema";
import { SpawnSessionForm } from "../components/spawn-session-form";
import { modalMetrics } from "../lib/modal-metrics";
import { useAppStore } from "../store/use-app-store";
import { useModalStore } from "../store/use-modal-store";

// Wide enough that the three controls on the model row and the longest model
// name either provider offers do not have to fight over the same columns.
const WIDTH = 76;

/** Opens the prompt box for a new agent in a project. Spawns nothing yet. */
export function openSpawnSession(project: Project): void {
	// the search has to let go first: two focused inputs is one too many, and the
	// keys would go to whichever the renderer happens to ask
	useAppStore.getState().focusRoster();

	useModalStore.getState().openModal({
		title: "spawn session",
		width: WIDTH,
		// The content width is handed down rather than looked up. Whoever picks
		// the panel width is the only one who can say how much room is left in it,
		// and skill descriptions are wrapped against that number — a column of
		// drift moves the wrap point on every line.
		children: (close) => (
			<SpawnSessionForm
				project={project}
				width={modalMetrics.inner(WIDTH)}
				close={close}
			/>
		),
	});
}
