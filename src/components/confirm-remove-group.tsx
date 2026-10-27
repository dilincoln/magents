import { useKeyboard } from "@opentui/react";
import type { Group } from "../../daemon/db/schema";
import { theme } from "../lib/theme";
import { useRemoveGroup } from "../queries/use-group-writes";
import { PressableText } from "./ui/pressable";

/**
 * The question before dropping a bucket.
 *
 * The second line is the one worth reading and it is reassurance rather than
 * warning, which is the opposite of every other confirm in this app. `⌃d` on a
 * heading with a dozen conversations under it looks exactly like `⌃d` on one of
 * them, and somebody who thinks this takes the sessions will not press it — so
 * the panel says what actually happens: the column is `on delete set null`, the
 * conversations survive, and they go back to hanging off the project the way
 * they did before anybody made a group.
 *
 * The cursor is not sent home afterwards, unlike removing a session. The rows
 * under this heading do not go anywhere — they move up four columns — so
 * whatever was selected is still a real row, and yanking the cursor to the top
 * would be the only thing that lost the reader's place.
 */
export function ConfirmRemoveGroup({
	group,
	count,
	onClose,
}: {
	group: Group;
	/** how many sessions are in it, so the sentence can be specific */
	count: number;
	onClose: () => void;
}) {
	const remove = useRemoveGroup();

	const confirm = () => {
		if (remove.isPending) return;
		remove.mutate(group.id, { onSuccess: onClose });
	};

	useKeyboard((key) => {
		if (key.name === "return" || key.name === "enter") confirm();
	});

	return (
		<>
			<text selectable={false} style={{ width: "100%", flexShrink: 0 }}>
				<b style={{ fg: theme.text }}>{group.title}</b>
				{group.hibernates ? (
					<text
						selectable={false}
						style={{ width: "100%", flexShrink: 0, fg: theme.faint }}
					>
						nothing will be hibernated by being moved here any more
					</text>
				) : null}
				{group.isDefault ? (
					<span style={{ fg: theme.muted }}>{"  · the default"}</span>
				) : null}
			</text>

			<text
				selectable={false}
				style={{ width: "100%", flexShrink: 0, marginTop: 1, fg: theme.warn }}
			>
				the group goes
			</text>
			<text
				selectable={false}
				style={{ width: "100%", flexShrink: 0, fg: theme.faint }}
			>
				{count === 0
					? "there is nothing in it"
					: `its ${count} session${count === 1 ? "" : "s"} stay, back under the project`}
			</text>
			{group.isDefault ? (
				<text
					selectable={false}
					style={{ width: "100%", flexShrink: 0, fg: theme.faint }}
				>
					new sessions will land under the project until another is made default
				</text>
			) : null}

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
