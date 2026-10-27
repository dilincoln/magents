import { useKeyboard } from "@opentui/react";
import type { Session } from "../../daemon/db/schema";
import { theme } from "../lib/theme";
import { useRemoveSession } from "../queries/use-remove-session";
import { useAppStore } from "../store/use-app-store";
import { PressableText } from "./ui/pressable";

/**
 * The question before dropping a session.
 *
 * It says what goes and, just as much, what does not — and here the second half
 * is the surprising one. Nothing about the conversation is ours: the provider's
 * CLI wrote it and still has it, so this removes a way back to it, not the
 * thing itself. Said plainly, because "remove session" reads like deleting the
 * work, and someone who believes that will not press the key they meant to.
 *
 * `enter` confirms, the same as removing a project. That is the destructive key
 * and normally a bad default; here it is the whole purpose of the panel, and
 * you had to ask for the panel to see it.
 */
export function ConfirmRemoveSession({
	session,
	onClose,
}: {
	session: Session;
	onClose: () => void;
}) {
	const remove = useRemoveSession();

	const confirm = () => {
		if (remove.isPending) return;
		remove.mutate(session.id, {
			onSuccess: () => {
				// what the cursor was on is gone, and the pane beside it was a
				// terminal attached to it — send the cursor home rather than let it
				// land on whatever slid into that row
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
				<b style={{ fg: theme.text }}>{session.title}</b>
			</text>
			<text
				selectable={false}
				style={{ width: "100%", flexShrink: 0, fg: theme.muted }}
			>
				{`${session.provider}${session.model ? ` · ${session.model}` : ""}`}
			</text>

			<text
				selectable={false}
				style={{ width: "100%", flexShrink: 0, marginTop: 1, fg: theme.warn }}
			>
				this row goes, and with it the way back to this conversation
			</text>
			<text
				selectable={false}
				style={{ width: "100%", flexShrink: 0, fg: theme.faint }}
			>
				{`the conversation itself stays — ${session.provider} keeps it`}
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
