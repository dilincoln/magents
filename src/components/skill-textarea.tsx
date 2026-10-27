import type { TextareaRenderable } from "@opentui/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import type { ProviderId } from "../../daemon/providers/provider-id";
import { barCursor } from "../constants/bar-cursor";
import { useSkillSuggestions } from "../hooks/use-skill-suggestions";
import type { Skill } from "../lib/read-skills";
import { skillMention } from "../lib/skill-mention";
import type { SlashToken } from "../lib/slash-token";
import { theme } from "../lib/theme";
import { wrapClamped } from "../lib/wrap-clamped";
import { skillsQuery } from "../queries/skills-query";
import { SuggestionPicker } from "./ui/suggestion-picker";

const NONE: Skill[] = [];
/**
 * How many rows the line under the box always takes.
 *
 * Fixed, not a maximum. The panel is centred, so a row gained or lost moves the
 * whole dialog in both directions — arrowing through the picker would make it
 * jump on every skill whose description happens to be longer than the last.
 * Three rows of empty is the price of a still panel.
 */
const DESCRIPTION_LINES = 3;

/**
 * A box to type into, with the skills of the project one `/` away.
 *
 * The textarea is uncontrolled — OpenTUI's takes an `initialValue` and owns its
 * own buffer — so the text and the caret are read back off the renderable on
 * every content and cursor change rather than pushed into it. That is also what
 * makes the caret usable: the picker needs to know *where* the `/` is, not just
 * that the text contains one, and a controlled `value` would not say.
 *
 * Accepting a suggestion rewrites the word the caret is in and puts the caret
 * after it, through `replaceText` rather than `setText` so the whole thing is
 * one undo away.
 *
 * Under the box is a block that says the most useful thing it can: the
 * description of the highlighted skill while the picker is up, and whatever the
 * caller wanted said the rest of the time. It is why the picker rows are names
 * only — here a description has three lines' width and can be read.
 *
 * The list is the selected provider's, and changes under the caret when the
 * provider does. Every row therefore carries the same mark, which is not the
 * redundancy it looks like: it is the same colour as the provider row above the
 * box, and it is what makes cycling with `⌃p` visibly change what a `/` means.
 */
export function SkillTextarea({
	projectPath,
	provider,
	placeholder = "type / for a skill…",
	initialValue = "",
	height = 6,
	width = 56,
	hint = "",
	focused = true,
	onChange,
	onSubmit,
}: {
	/** whose skills folders to read — global and local, for both providers */
	projectPath: string;
	/**
	 * Whose skills to offer, of the ones read.
	 *
	 * A skill is a file one provider knows how to run, so a list that ignored
	 * the provider about to run the prompt was offering things that would not
	 * work — a `/` under codex was showing claude's plugins. Filtered here and
	 * not in the query: the four directories are read once per project, and
	 * splitting the cache by provider would read them twice to show half as much.
	 */
	provider: ProviderId;
	placeholder?: string;
	initialValue?: string;
	height?: number;
	/**
	 * How wide the line under the box may be. A description one character too
	 * long does not clip, it wraps, and a wrapped line moves everything below it.
	 */
	width?: number;
	/** what that line says when no skill is highlighted */
	hint?: string;
	focused?: boolean;
	onChange?: (value: string) => void;
	onSubmit?: (value: string) => void;
}) {
	const area = useRef<TextareaRenderable>(null);
	const [text, setText] = useState(initialValue);
	const [caret, setCaret] = useState(initialValue.length);

	const all = useQuery(skillsQuery(projectPath)).data ?? NONE;
	// memoized because `useSkillSuggestions` matches against this array's
	// identity: a fresh one per render would rebuild the list on every keystroke
	const skills = useMemo(
		() => all.filter((skill) => skill.provider === provider),
		[all, provider],
	);

	const sync = () => {
		const renderable = area.current;
		if (!renderable) return;

		const next = renderable.plainText;
		setCaret(renderable.cursorOffset);
		if (next === text) return;

		setText(next);
		onChange?.(next);
	};

	const accept = (skill: Skill, token: SlashToken) => {
		const renderable = area.current;
		if (!renderable) return;

		// The mention brings its own trailing space, so a space already sitting
		// after the word is one too many — swallow it. Completing in the middle of
		// `write /do| now` has to come out `write /do now`, not with a gap in it.
		const inserted = skillMention(skill);
		const tail = text[token.end] === " " ? token.end + 1 : token.end;
		const next = text.slice(0, token.start) + inserted + text.slice(tail);

		renderable.replaceText(next);
		renderable.cursorOffset = token.start + inserted.length;
		sync();
	};

	const {
		suggestions,
		highlight,
		highlighted,
		accept: pick,
	} = useSkillSuggestions({ text, caret, skills, onAccept: accept });

	const hasSkillOrHint = highlighted?.description ?? hint;

	return (
		<box
			style={{
				width: "100%",
				flexShrink: 0,
				flexDirection: "column",
				backgroundColor: theme.panel,
			}}
		>
			<SuggestionPicker
				skills={suggestions}
				highlight={highlight}
				onPick={pick}
			/>

			<box
				style={{
					width: "100%",
					height,
					flexShrink: 0,
					backgroundColor: theme.bg,
				}}
			>
				<textarea
					ref={area}
					focused={focused}
					initialValue={initialValue}
					placeholder={placeholder}
					onContentChange={sync}
					onCursorChange={sync}
					onSubmit={() => onSubmit?.(text)}
					style={{
						width: "100%",
						height,
						backgroundColor: theme.bg,
						focusedBackgroundColor: theme.bg,
						textColor: theme.text,
						focusedTextColor: theme.text,
						placeholderColor: theme.faint,
						cursorColor: theme.accent,
						cursorStyle: barCursor,
						wrapMode: "word",
					}}
				/>
			</box>

			{/*
			 * One line, whatever it has to say. The description is the reason the
			 * rows are only names: here it has a line's width and can be read.
			 */}
			{hasSkillOrHint && (
				<text
					selectable={false}
					style={{
						width: "100%",
						height: DESCRIPTION_LINES,
						flexShrink: 0,
						marginTop: 1,
						// the lines are already broken; leaving the default `"word"` would
						// re-wrap them, and a `width` one column too generous would grow a
						// fourth row and shove everything below it
						wrapMode: "none",
						fg: highlighted ? theme.muted : theme.faint,
					}}
				>
					{wrapClamped(
						highlighted?.description ?? hint,
						width,
						DESCRIPTION_LINES,
					).join("\n")}
				</text>
			)}
		</box>
	);
}
