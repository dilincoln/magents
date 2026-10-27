import { useState } from "react";
import type { Session } from "../../daemon/db/schema";
import { barCursor } from "../constants/bar-cursor";
import { theme } from "../lib/theme";
import { useRenameSession } from "../queries/use-rename-session";
import { PressableText } from "./ui/pressable";

/**
 * A session's name, which is the one thing about it that is yours to change.
 *
 * Everything else on the row is a fact — the handle belongs to the provider,
 * the project is where the conversation ran, the model is what it was started
 * on. The title is the only field that was ever a guess, made from a first line
 * before anybody knew what the conversation would turn into, so it is the only
 * one worth a form.
 *
 * Pre-filled with the name it has and focused, which makes the common case one
 * keystroke away from done: the guess is usually nearly right, and correcting a
 * word is faster than retyping a sentence.
 */
export function RenameSessionForm({
	session,
	onClose,
}: {
	session: Session;
	onClose: () => void;
}) {
	const [title, setTitle] = useState(session.title);
	const rename = useRenameSession();

	const ready = title.trim().length > 0 && !rename.isPending;

	const submit = () => {
		// no double submits: enter is easy to hit twice, and the second one would
		// race the first with a form that is already gone
		if (!ready) return;
		rename.mutate(
			{ id: session.id, title: title.trim() },
			{ onSuccess: onClose },
		);
	};

	return (
		<>
			<box
				style={{
					width: "100%",
					flexShrink: 0,
					flexDirection: "row",
					backgroundColor: theme.bg,
				}}
			>
				<text
					selectable={false}
					style={{ flexShrink: 0, fg: theme.accent, bg: theme.bg }}
				>
					{" "}
				</text>

				<input
					focused={!rename.isPending}
					value={title}
					placeholder="what this conversation is about"
					onInput={setTitle}
					onSubmit={submit}
					style={{
						flexGrow: 1,
						flexShrink: 1,
						backgroundColor: theme.bg,
						focusedBackgroundColor: theme.bg,
						textColor: theme.text,
						focusedTextColor: theme.text,
						placeholderColor: theme.faint,
						cursorColor: theme.accent,
						cursorStyle: barCursor,
					}}
				/>
			</box>

			<text
				selectable={false}
				style={{
					width: "100%",
					flexShrink: 0,
					marginTop: 1,
					fg: rename.error ? theme.warn : theme.faint,
				}}
			>
				{rename.error?.message ??
					(rename.isPending
						? "renaming…"
						: "enter renames it · only the row changes, the conversation is untouched")}
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
					onPress={ready ? submit : undefined}
					style={{ flexShrink: 0, fg: ready ? theme.accent : theme.faint }}
				>
					{"  rename  "}
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
