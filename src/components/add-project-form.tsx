import { useState } from "react";
import { barCursor } from "../constants/bar-cursor";
import { usePathCompletion } from "../hooks/use-path-completion";
import { theme } from "../lib/theme";
import { useAddProject } from "../queries/use-add-project";
import { FilePeek } from "./ui/file-peek";
import { PressableText } from "./ui/pressable";

/**
 * The path of a repository, sent to the backend.
 *
 * Pre-filled with the working directory, which is the answer most of the time —
 * you run magents from the repo you are working in, and enter is then the whole
 * interaction.
 *
 * The field is `focused` outright rather than through the focus store: a modal
 * already owns the keyboard by the time this renders, and the action that
 * spawned it took focus off the search first, so there is nothing to arbitrate.
 *
 * `FilePeek` under it lists what the path could mean and hands back a pick,
 * which is just the field's next value — the field stays the single source of
 * what will be sent.
 *
 * Enter is offered to the completion first. A highlighted row is a promise
 * about the next enter, and the form is where that promise has to be kept: the
 * input fires `onSubmit` on enter regardless, so a picker answering enter by
 * itself would complete and submit in the same keystroke.
 *
 * The only state declared here is the path. Whether the call is in flight and
 * what it said when it failed belong to the mutation, which already knows both;
 * keeping local copies alongside it is how the two end up disagreeing.
 */
export function AddProjectForm({ onClose }: { onClose: () => void }) {
	const [path, setPath] = useState(process.cwd());
	const add = useAddProject();

	const completion = usePathCompletion(path, setPath);

	const submit = () => {
		// no double submits: enter is easy to hit twice, and the second one would
		// race the first with a form that is already gone
		if (add.isPending) return;
		add.mutate(path, { onSuccess: onClose });
	};

	// What enter does. The `add` button is not this: clicking add means add, even
	// with a row highlighted.
	const confirm = () => {
		if (add.isPending) return;
		if (completion.takeEnter()) return;
		submit();
	};

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
				path to the repository
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
					focused={!add.isPending}
					value={path}
					placeholder="/home/you/code/thing"
					onInput={setPath}
					onSubmit={confirm}
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

			<FilePeek
				entries={completion.entries}
				highlight={completion.highlight}
				onPick={setPath}
			/>

			{/* the backend's own sentence, not a translation of it: it is the only
			    thing that knows why the path was refused */}
			<text
				selectable={false}
				style={{
					width: "100%",
					flexShrink: 0,
					marginTop: 1,
					fg: add.error ? theme.warn : theme.faint,
				}}
			>
				{add.error?.message ??
					(add.isPending
						? "adding…"
						: completion.highlight !== null
							? "enter takes the highlighted folder"
							: "enter adds it · the folder name becomes the project")}
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
					style={{ flexShrink: 0, fg: theme.accent }}
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
