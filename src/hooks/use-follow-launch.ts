import { useEffect } from "react";
import { useAppStore, useVisibleRows } from "../store/use-app-store";

/**
 * Puts the cursor on a session the moment it appears.
 *
 * Opening one is a two-step: the daemon answers, and the roster catches up on
 * the refetch that follows. Nothing can be selected in between, because the row
 * does not exist yet — so the intention is held in the store and spent here, on
 * whichever render finally has the row in it. Held, and then dropped here too:
 * a launch means nothing except "put the cursor there", and there is no later
 * moment at which that is still owed.
 */
export function useFollowLaunch(): void {
	const launch = useAppStore((state) => state.launch);
	const rows = useVisibleRows();

	useEffect(() => {
		if (!launch) return;

		const at = rows.findIndex(
			(row) => row.kind === "session" && row.session.id === launch.sessionId,
		);
		if (at === -1) return;

		/*
		 * Selected *and* focused. The first version stopped at selected, on the
		 * theory that the next key should be a choice rather than a keystroke
		 * sent to an agent still starting up — which was wrong in the only way
		 * that matters: what someone does after asking for a session is talk to
		 * it, and a pane that looks ready while the keyboard is somewhere else
		 * means the first thing they type runs the roster's shortcuts. `q` quit.
		 *
		 * `setCursor` puts the keyboard back on the roster by itself, so the
		 * order here is not cosmetic.
		 */
		const state = useAppStore.getState();
		state.setCursor(at);
		state.focusTerminal();

		// Spent here, where it is spent on the thing it was for. It used to be
		// dropped by the pane's mount effect, back when it carried a command and
		// "consumed" meant the command had been run; it carries nothing now, so
		// the only moment it stops being true is this one — the cursor landed.
		state.consumeLaunch();
	}, [launch, rows]);
}
