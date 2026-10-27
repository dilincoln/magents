import { useKeyboard } from "@opentui/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { Group } from "../../daemon/db/schema";
import { barCursor } from "../constants/bar-cursor";
import { theme } from "../lib/theme";
import { groupsQuery } from "../queries/groups-query";
import { useUpdateGroup } from "../queries/use-group-writes";
import { PressableText } from "./ui/pressable";

const NONE: Group[] = [];

/**
 * Everything about a bucket that can change: its name, whether new sessions
 * land in it, and whether what is moved into it goes to sleep.
 *
 * The same three fields as the form that makes one, in the same order and with
 * the same chords, because they are the same three facts — a panel that could
 * only rename would mean the two other decisions were final at the moment the
 * group was born, which is the one moment somebody knows least about them.
 *
 * The default is the asymmetric one. It can be taken but not given back: a
 * project either has a home for new sessions or it has not, so there is no such
 * thing as "no longer the default" — only "that one instead". So the toggle is
 * live on a group that is not the default and locked on the group that is, and
 * turning it on names the group it is being taken from, since making this one
 * the default is the same act as ending the other one's.
 *
 * The daemon holds the rule that two groups in a project cannot share a title
 * and answers with a sentence when it is broken; that sentence goes on screen
 * as it came, rather than being anticipated here.
 */
export function EditGroupForm({
	group,
	onClose,
}: {
	group: Group;
	onClose: () => void;
}) {
	const [title, setTitle] = useState(group.title);
	const [isDefault, setDefault] = useState(group.isDefault);
	const [hibernates, setHibernates] = useState(group.hibernates);
	const edit = useUpdateGroup();

	// who currently holds it, so that turning this on can say whose it was. Null
	// when this group is the one holding it, which is the case the line below
	// never asks about.
	const holder = (useQuery(groupsQuery).data ?? NONE).find(
		(one) =>
			one.projectId === group.projectId && one.isDefault && one.id !== group.id,
	);

	const clean = title.trim();
	const ready = clean.length > 0 && !edit.isPending;

	const submit = () => {
		if (!ready) return;

		const patch = {
			...(clean === group.title ? {} : { title: clean }),
			// only ever `true`, and only when it is news — the daemon refuses the
			// word `false` rather than ignoring it
			...(isDefault && !group.isDefault ? { default: true as const } : {}),
			...(hibernates === group.hibernates ? {} : { hibernates }),
		};

		// A form somebody opened and read is a form they are allowed to close
		// with `⏎`. Sending an empty patch would earn a 400 saying nothing was
		// asked for, which is true and useless.
		if (Object.keys(patch).length === 0) return onClose();

		edit.mutate({ id: group.id, ...patch }, { onSuccess: onClose });
	};

	// A chord, because the field below has the keyboard and every bare key in
	// this panel is a character in a name.
	useKeyboard((key) => {
		if (!key.ctrl) return;

		// `⌃f` does nothing on the group that already has it. Not because the
		// press is wrong, but because there is nothing it could mean: unsetting
		// is the one thing a default cannot do.
		if (key.name === "f" && !group.isDefault) setDefault((on) => !on);
		else if (key.name === "z") setHibernates((on) => !on);
		else return;

		key.preventDefault();
		key.stopPropagation();
	});

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
					focused={!edit.isPending}
					value={title}
					placeholder="what this bucket is for"
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
			{group.isDefault ? (
				// two lines rather than one with the reason after a dot: the sentence
				// that explains the missing `⌃f` is longer than the line it follows,
				// and forty-eight columns is all a panel this wide has
				<>
					<text
						selectable={false}
						style={{
							width: "100%",
							flexShrink: 0,
							marginTop: 1,
							fg: theme.accent,
						}}
					>
						{"▰    new sessions land here"}
					</text>
					<text
						selectable={false}
						style={{ width: "100%", flexShrink: 0, fg: theme.faint }}
					>
						{"     make another group the default to move it"}
					</text>
				</>
			) : (
				<>
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

					{/* under it, in the same column the locked panel puts its sentence,
					    because it is the same sentence from the other side: this group
					    becoming the default is that one stopping being it, and finding
					    that out afterwards is finding it out too late */}
					{isDefault && holder ? (
						<text
							selectable={false}
							style={{ width: "100%", flexShrink: 0, fg: theme.faint }}
						>
							{`     taken from ${holder.title}`}
						</text>
					) : null}
				</>
			)}

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
					fg: edit.error ? theme.warn : theme.faint,
				}}
			>
				{edit.error?.message ?? (edit.isPending ? "saving…" : "enter saves it")}
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
					style={{ flexShrink: 0, fg: ready ? theme.accent : theme.faint }}
				>
					{"  save  "}
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
