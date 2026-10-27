import { useKeyboardOwner } from "../store/keyboard-owner";
import { useModalStore } from "../store/use-modal-store";
import { Modal } from "./ui/modal";

/**
 * Renders whatever was last spawned. Mounted once, near the root — a modal has
 * to escape the layout it was opened from, and it cannot do that from inside it.
 *
 * It also names the way out, because the name depends on who has the keyboard
 * and the primitive is not allowed to ask. A suggestion picker open inside a
 * modal outranks it, and there `esc` dismisses the list and leaves the modal
 * standing — so the label drops the key and says only what the click does. A
 * hint that is offered and then ignored is worse than no hint.
 *
 * A locked modal is handed no `onClose` at all, which is the same sentence said
 * to the primitive: the dismiss control disappears and clicking away does
 * nothing, because there is nothing to close to. See `locked` in the store.
 */
export function ModalHost() {
	const modal = useModalStore((state) => state.modal);
	const close = useModalStore((state) => state.closeModal);
	const locked = useModalStore((state) => state.locked);
	const owner = useKeyboardOwner();

	if (!modal) return null;

	return (
		<Modal
			title={modal.title}
			dismiss={owner === "modal" ? "esc close" : "close"}
			hint={modal.hint}
			width={modal.width}
			backdrop={modal.backdrop}
			onClose={locked ? undefined : close}
		>
			{modal.children(close)}
		</Modal>
	);
}
