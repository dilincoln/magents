import { useKeyboard } from "@opentui/react";
import type { Project } from "../../daemon/db/schema";
import { theme } from "../lib/theme";
import { useRemoveProject } from "../queries/use-remove-project";
import { useAppStore } from "../store/use-app-store";
import { PressableText } from "./ui/pressable";

/**
 * The question before a removal that cannot be undone.
 *
 * It says what goes and, just as much, what does not. "Delete project" reads
 * like it deletes the repository, and that is the fear worth answering out
 * loud: the row goes, the sessions go with it, the files stay exactly where
 * they are.
 *
 * `enter` confirms. That is the destructive key, which is normally a bad
 * default — here it is the whole purpose of the panel, and you had to ask for
 * this panel to see it. `esc` and clicking away both cancel, which is the modal
 * primitive's own contract.
 */
export function ConfirmRemoveProject({
	project,
	onClose,
}: {
	project: Project;
	onClose: () => void;
}) {
	const remove = useRemoveProject();

	const confirm = () => {
		if (remove.isPending) return;
		remove.mutate(project.id, {
			onSuccess: () => {
				// what the cursor was on is gone; every other thing that changes what
				// is visible sends it home too
				useAppStore.getState().setCursor(0);
				onClose();
			},
		});
	};

	useKeyboard((key) => {
		if (key.name === "return" || key.name === "enter") confirm();
	});

	return (
		<>
			<text selectable={false} style={{ width: "100%", flexShrink: 0 }}>
				<b style={{ fg: theme.text }}>{project.name}</b>
			</text>
			<text
				selectable={false}
				style={{ width: "100%", flexShrink: 0, fg: theme.muted }}
			>
				{project.path}
			</text>

			<text
				selectable={false}
				style={{ width: "100%", flexShrink: 0, marginTop: 1, fg: theme.warn }}
			>
				every session in this project is deleted with it
			</text>
			<text
				selectable={false}
				style={{ width: "100%", flexShrink: 0, fg: theme.faint }}
			>
				nothing on disk is touched — the repository stays
			</text>

			{remove.error ? (
				<text
					selectable={false}
					style={{ width: "100%", flexShrink: 0, marginTop: 1, fg: theme.warn }}
				>
					{remove.error.message}
				</text>
			) : null}

			<box
				style={{
					width: "100%",
					flexShrink: 0,
					flexDirection: "row",
					marginTop: 1,
					backgroundColor: theme.panel,
				}}
			>
				<PressableText
					onPress={confirm}
					style={{ flexShrink: 0, fg: theme.warn }}
				>
					{remove.isPending ? "  removing…  " : "  remove  "}
				</PressableText>
				<PressableText
					onPress={onClose}
					style={{ flexShrink: 0, marginLeft: 2, fg: theme.muted }}
				>
					{"  cancel  "}
				</PressableText>
			</box>
		</>
	);
}
