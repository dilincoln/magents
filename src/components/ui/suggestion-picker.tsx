import type { Skill } from "../../lib/read-skills";
import { theme } from "../../lib/theme";
import { Pressable } from "./pressable";
import { ProviderMark } from "./provider-mark";

/** How many rows are worth showing before the list stops being a peek. */
const ROWS = 5;
/** Where the scope marker starts, so the markers form a column. */
const NAME_COLUMN = 22;

/**
 * The skills a `/` could mean, listed above the box being typed in.
 *
 * Above rather than below, because the box grows downward as it fills and a
 * list under it would be pushed around by the thing it is describing.
 *
 * **Names only.** The description of the highlighted one goes under the box, in
 * full, where there is a line's width for it — a description squeezed into each
 * row is five sentences cut off at forty characters, which is five things you
 * cannot read instead of one you can.
 *
 * Presentational, like everything in `ui/`: it is handed the skills and which
 * one is highlighted, and it reports a click. Each row carries its provider's
 * mark — the same diamond the roster uses, orange for claude and green for
 * codex — because a skill belongs to whichever convention it was found under,
 * and two providers can offer one by the same name.
 *
 * The right-hand column says where a skill came from when that is not the
 * ordinary answer: the plugin's name, or `local` for one kept in the
 * repository. A user-level skill says nothing, because it is the default.
 */
export function SuggestionPicker({
	skills,
	highlight,
	onPick,
}: {
	skills: Skill[];
	highlight: number;
	onPick: (skill: Skill) => void;
}) {
	if (skills.length === 0) return null;

	const shown = skills.slice(0, ROWS);
	const rest = skills.length - shown.length;

	return (
		<box
			style={{
				width: "100%",
				flexShrink: 0,
				marginBottom: 1,
				flexDirection: "column",
				backgroundColor: theme.panel,
			}}
		>
			{shown.map((skill, position) => {
				const active = position === highlight;

				return (
					<Pressable
						key={`${skill.provider}:${skill.path}`}
						onPress={() => onPick(skill)}
						background={active ? theme.lineActive : theme.panel}
						// the highlighted row keeps its colour: enter takes that one, and
						// the pointer being elsewhere does not change which
						hover={active ? theme.lineActive : theme.hover}
						style={{
							width: "100%",
							flexShrink: 0,
							flexDirection: "row",
							justifyContent: "space-between",
						}}
					>
						<text selectable={false}>
							<span style={{ fg: active ? theme.accent : theme.faint }}>
								{active ? "▸ " : "  "}
							</span>
							<ProviderMark provider={skill.provider} />
							<span style={{ fg: active ? theme.text : theme.muted }}>
								{` ${skill.name.padEnd(NAME_COLUMN)}`}
							</span>
						</text>

						{origin(skill) ? (
							<text style={{ fg: theme.violet }}>{origin(skill)}</text>
						) : null}
					</Pressable>
				);
			})}

			{rest > 0 ? (
				<text
					selectable={false}
					style={{ width: "100%", flexShrink: 0, fg: theme.faint }}
				>
					{`  + ${rest} more — keep typing`}
				</text>
			) : null}
		</box>
	);
}

/** Where it came from, when that is worth saying. */
const origin = (skill: Skill): string =>
	skill.plugin ?? (skill.scope === "local" ? "local" : "");
