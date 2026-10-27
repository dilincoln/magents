import { useKeyboard } from "@opentui/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { Group } from "../../daemon/db/schema";
import type { LiveSession as Session } from "../../daemon/services/terminals";
import { theme } from "../lib/theme";
import { groupsQuery } from "../queries/groups-query";
import { useMoveSession } from "../queries/use-move-session";
import { PressableText } from "./ui/pressable";

const NONE: Group[] = [];

/**
 * Where a session should sit, picked from the buckets its project has.
 *
 * A list rather than a cycling chord, unlike the picker in the spawn panel.
 * There the group is one of four things being decided at once and a ring keeps
 * the row short; here it is the only question, the answer is already on screen,
 * and a project with eight buckets would be eight presses of a key to reach the
 * last one.
 *
 * *No group* is an option and sits at the end, past the buckets. It is where a
 * session lands when its group is removed and what `--no-group` asks for, so it
 * is a real place rather than the absence of one.
 *
 * A group that hibernates says so beside its name. That is the one option here
 * with a consequence beyond where the row is drawn — picking it stops the agent
 * — and a list that let somebody discover that afterwards would be a list that
 * hid the only thing worth warning about.
 */
export function MoveSessionForm({
	session,
	onClose,
}: {
	session: Session;
	onClose: () => void;
}) {
	const groups = (useQuery(groupsQuery).data ?? NONE).filter(
		(group) => group.projectId === session.projectId,
	);

	const options: (Group | null)[] = [...groups, null];

	// starts on where it already is, so the list opens showing the answer it
	// currently has rather than asking from nothing
	const [cursor, setCursor] = useState(() => {
		const at = groups.findIndex((group) => group.id === session.groupId);
		return at === -1 ? options.length - 1 : at;
	});

	const move = useMoveSession();

	const pick = (index: number) => {
		if (move.isPending) return;

		const target = options[Math.min(index, options.length - 1)] ?? null;

		// Already there is not a move, and the daemon would agree — it only fires
		// a group's rule on a real change. Closing is the honest answer to
		// "put it where it already is".
		if ((target?.id ?? null) === (session.groupId ?? null)) {
			onClose();
			return;
		}

		move.mutate(
			{ id: session.id, groupId: target?.id ?? null },
			{ onSuccess: onClose },
		);
	};

	useKeyboard((key) => {
		if (move.isPending) return;

		if (key.name === "up" || key.name === "k") {
			setCursor((at) => (at - 1 + options.length) % options.length);
			key.preventDefault();
			return;
		}

		if (key.name === "down" || key.name === "j") {
			setCursor((at) => (at + 1) % options.length);
			key.preventDefault();
			return;
		}

		if (key.name === "return" || key.name === "enter") {
			pick(cursor);
			key.preventDefault();
		}
	});

	return (
		<>
			<text
				selectable={false}
				style={{
					width: "100%",
					flexShrink: 0,
					marginBottom: 1,
					fg: theme.muted,
				}}
			>
				{session.title}
			</text>

			{options.map((option, at) => {
				const here = (option?.id ?? null) === (session.groupId ?? null);
				const active = at === cursor;

				return (
					<PressableText
						key={option?.id ?? "none"}
						onPress={() => {
							setCursor(at);
							pick(at);
						}}
						background={active ? theme.lineActive : theme.panel}
						hover={theme.lineActive}
						style={{
							width: "100%",
							flexShrink: 0,
							fg: active ? theme.text : theme.muted,
						}}
					>
						{`${active ? " ▸ " : "   "}${option ? option.title : "no group"}${
							here ? "  · where it is" : ""
						}${option?.hibernates ? "  · hibernates it" : ""}`}
					</PressableText>
				);
			})}

			<text
				selectable={false}
				style={{
					width: "100%",
					flexShrink: 0,
					marginTop: 1,
					fg: move.error ? theme.warn : theme.faint,
				}}
			>
				{move.error?.message ??
					(move.isPending ? "moving…" : "↑↓ pick · enter moves it")}
			</text>

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
					onPress={onClose}
					style={{ flexShrink: 0, fg: theme.muted }}
				>
					{"  cancel  "}
				</PressableText>
			</box>
		</>
	);
}
