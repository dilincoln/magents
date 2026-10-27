import { useModalStore } from "../store/use-modal-store";
import { openHelp } from "./open-help";

/**
 * What the `? keys` button does. Any modal being up counts as "open" — the
 * button is where the eye already is, so it should put down whatever is on the
 * screen rather than stack another panel behind it.
 */
export function toggleHelp(): void {
	const { modal, closeModal } = useModalStore.getState();
	if (modal) closeModal();
	else openHelp();
}
