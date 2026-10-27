import { HelpKeys } from "../components/help-keys";
import { useModalStore } from "../store/use-modal-store";

/** Spawns the key list. */
export function openHelp(): void {
	useModalStore.getState().openModal({
		title: "keys",
		// wider than the other panels, and the only one that is: every other modal
		// is a form a few fields tall, this is two columns of text as long as the
		// key table — the room goes into the sentences, which are what somebody
		// opened it to read.
		width: 70,
		// the way out is the panel's own now, and the footer says the rest
		children: () => <HelpKeys />,
	});
}
