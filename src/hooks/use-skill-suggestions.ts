import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useState } from "react";
import type { Skill } from "../lib/read-skills";
import { skillMention } from "../lib/skill-mention";
import { type SlashToken, slashTokenAt } from "../lib/slash-token";
import { useSuggestionsStore } from "../store/use-suggestions-store";

export interface SkillSuggestions {
	/** what to show; empty means the picker is shut */
	suggestions: Skill[];
	highlight: number;
	/** the row enter would take — its description is what the box explains */
	highlighted: Skill | undefined;
	/** put one in the text, from a click as readily as from the keyboard */
	accept: (skill: Skill) => void;
}

/**
 * The skill picker behind a `/`, and the keys that drive it.
 *
 * Like `usePathCompletion`, the state lives out here rather than in the list
 * component, because the keys it holds are keys something else also wants. Here
 * that something else is the textarea itself: `↑` `↓` move the caret and
 * `return` inserts a newline, so every key the picker uses has to be taken away
 * from it explicitly.
 *
 * `preventDefault` is what takes it. A global key handler runs before the
 * renderable's own, so marking the event handled is enough to stop the textarea
 * acting on it — no key bindings to override, nothing to put back afterwards.
 */
export function useSkillSuggestions({
	text,
	caret,
	skills,
	onAccept,
}: {
	text: string;
	caret: number;
	skills: Skill[];
	onAccept: (skill: Skill, token: SlashToken) => void;
}): SkillSuggestions {
	const token = useMemo(() => slashTokenAt(text, caret), [text, caret]);

	const matches = useMemo(
		() => (token ? match(skills, token.query, token.settled) : []),
		[skills, token],
	);

	// Escape shuts the picker for the token it was opened on, not forever: move
	// the caret to another `/word` and that is a different question being asked.
	const [dismissed, setDismissed] = useState<number | null>(null);

	const open =
		token !== null && matches.length > 0 && dismissed !== token.start;

	const [highlight, setHighlight] = useState(0);
	const [shownFor, setShownFor] = useState(token?.query);

	// A different query is a different list, and an index left over from the old
	// one would sit on whatever happens to occupy that slot now.
	if (shownFor !== token?.query) {
		setShownFor(token?.query);
		setHighlight(0);
	}

	// The screen has to know, because escape belongs to the picker while it is up
	// and to the modal underneath when it is not. Cleared on unmount so a closed
	// form cannot leave the keyboard pointing at a list that is gone.
	const setOpen = useSuggestionsStore((state) => state.setOpen);
	useEffect(() => {
		setOpen(open);
		return () => setOpen(false);
	}, [open, setOpen]);

	const highlighted = open ? matches[highlight] : undefined;

	/**
	 * Whether the word under the caret is already exactly the highlighted skill.
	 *
	 * This is what stops `enter` re-accepting what it just accepted. It is read
	 * off the text rather than remembered, which matters: a flag saying "this was
	 * accepted" cannot tell one `/do ` from another, and killed the picker for
	 * every later mention of a skill that had been used once.
	 *
	 * The picker stays *visible* either way — the skill and its description are
	 * worth seeing while the rest of the line is written. Only the key gives way:
	 * with nothing left to complete, `enter` does what it does everywhere else in
	 * a textarea and starts a new line.
	 */
	const complete =
		token !== null &&
		highlighted !== undefined &&
		text.slice(token.start, token.end) === skillMention(highlighted);

	// One way in, so a click and a keystroke cannot end up doing subtly different
	// things.
	const accept = (skill: Skill) => {
		if (!token) return;
		onAccept(skill, token);
	};

	useKeyboard((key) => {
		if (!open || !token) return;

		const move = (delta: number) =>
			setHighlight(
				(current) => (current + delta + matches.length) % matches.length,
			);

		switch (key.name) {
			case "up":
				move(-1);
				break;
			case "down":
				move(1);
				break;
			case "return":
			case "kpenter":
			case "tab": {
				// nothing to insert: let the textarea have the key
				if (complete) return;
				const skill = matches[highlight];
				if (skill) accept(skill);
				break;
			}
			case "escape":
				setDismissed(token.start);
				break;
			default:
				return;
		}

		key.preventDefault();
		key.stopPropagation();
	});

	return {
		suggestions: open ? matches : [],
		highlight,
		highlighted,
		accept,
	};
}

/**
 * Name first, then description. A slash is someone reaching for a name they
 * half remember, so anything the name matches outranks everything the
 * description matches — but the description is still searched, because half the
 * time the name is the part they do not remember at all.
 *
 * Within the names: the exact one, then the ones that start with it, then the
 * rest. Beyond being the obvious order, it is what makes a finished mention
 * highlight itself — `/do ` has to put `do` on top and not `ado`, or `enter`
 * would helpfully replace what was just written.
 *
 * A settled name is not searched at all, only matched. Once the space is typed
 * the name is finished, and offering `dotnet-inspect` or `handoff` under a
 * finished `/do` is answering a question nobody asked — the list should be the
 * one skill that word names, or nothing.
 */
function match(skills: Skill[], query: string, settled: boolean): Skill[] {
	const needle = query.toLowerCase();
	if (settled) {
		return skills.filter((skill) => skill.name.toLowerCase() === needle);
	}
	if (needle === "") return skills;

	const rank = (skill: Skill) => {
		const name = skill.name.toLowerCase();
		return name === needle ? 0 : name.startsWith(needle) ? 1 : 2;
	};

	const byName = skills
		.filter((skill) => skill.name.toLowerCase().includes(needle))
		.sort((a, b) => rank(a) - rank(b));
	const byDescription = skills.filter(
		(skill) =>
			!skill.name.toLowerCase().includes(needle) &&
			skill.description.toLowerCase().includes(needle),
	);

	return [...byName, ...byDescription];
}
