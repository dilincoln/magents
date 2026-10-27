import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { Project } from "../../daemon/db/schema";
import { barCursor } from "../constants/bar-cursor";
import { theme } from "../lib/theme";
import { useCreateGroup } from "../queries/use-group-writes";
import { PressableText } from "./ui/pressable";

/**
 * A new bucket in a project, and whether new sessions should land in it.
 *
 * The default toggle is on the form rather than being a second step, because
 * making a group and deciding it is where work goes is usually one thought —
 * the first group anybody makes is the one they want everything in. `⌃f` for
 * it, a chord like everything else that has to survive being pressed while
 * typing a name.
 *
 * Nothing here validates the name beyond refusing an empty one. The daemon
 * holds the real rule — a project cannot have two groups with one title — and
 * answers with a sentence when it is broken, which is put on screen as it came.
 * A copy of that rule here would be a second place for it to drift.
 */
export function AddGroupForm({
	project,
	onClose,
}: {
	project: Project;
	onClose: () => void;
}) {
	const [title, setTitle] = useState("");
	const [isDefault, setDefault] = useState(false);
	const [hibernates, setHibernates] = useState(false);
	const create = useCreateGroup();

	const submit = () => {
		// no double submits: enter is easy to hit twice, and the second one would
		// race the first with a form that is already gone
		if (create.isPending || !title.trim()) return;

		create.mutate(
			{
				projectId: project.id,
				title: title.trim(),
				default: isDefault,
				hibernates,
			},
			{ onSuccess: onClose },
		);
	};

	// A chord, because the field below has the keyboard and every bare key in
	// this panel is a character in a name.
	useKeyboard((key) => {
		if (!key.ctrl) return;

		if (key.name === "f") setDefault((current) => !current);
		else if (key.name === "z") setHibernates((current) => !current);
		else return;

		key.preventDefault();
		key.stopPropagation();
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
				{`a group in ${project.name}`}
			</text>

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
					focused={!create.isPending}
					value={title}
					placeholder="Active"
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

			{/* checkboxes, and they are the only place these two facts wear a glyph
			    — the roster says the first with the colour of the fold arrow and the
			    second in words. A form has to show an empty state as well as a set
			    one, which a colour cannot do: there is no unlit accent. */}
			<PressableText
				onPress={() => setDefault(!isDefault)}
				style={{
					width: "100%",
					flexShrink: 0,
					marginTop: 1,
					fg: isDefault ? theme.accent : theme.faint,
				}}
			>
				{`${isDefault ? "▰" : "▱"} ⌃f  new sessions land here`}
			</PressableText>

			{/* "moved in", not "opened in", and the wording is the rule: opening a
			    session is asking for work to start, so the daemon never fires this
			    on creation — only when something is moved here later. */}
			<PressableText
				onPress={() => setHibernates(!hibernates)}
				style={{
					width: "100%",
					flexShrink: 0,
					fg: hibernates ? theme.accent : theme.faint,
				}}
			>
				{`${hibernates ? "z" : "·"} ⌃z  hibernate what is moved here`}
			</PressableText>

			<text
				selectable={false}
				style={{
					width: "100%",
					flexShrink: 0,
					marginTop: 1,
					fg: create.error ? theme.warn : theme.faint,
				}}
			>
				{create.error?.message ??
					(create.isPending ? "making it…" : "enter makes it")}
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
					onPress={submit}
					style={{
						flexShrink: 0,
						fg: title.trim() ? theme.accent : theme.faint,
					}}
				>
					{"  add  "}
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
