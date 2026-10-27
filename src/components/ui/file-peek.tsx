import type { DirEntry } from "../../lib/list-directory";
import { theme } from "../../lib/theme";
import { PressableText } from "./pressable";

/** How many rows are worth showing before the list stops being a peek. */
const ROWS = 6;
/** Where the `git` marker starts, so the markers form a column and not a fringe. */
const NAME_COLUMN = 24;

/**
 * What the path being typed could mean, listed under the field.
 *
 * A path field with nothing under it asks you to remember your own filesystem
 * and spells the mistake out only after you commit. This shows the answer while
 * the question is still being asked.
 *
 * Presentational, like everything in `ui/`: it is handed the entries and which
 * one is highlighted, and it reports a click. The keys and the highlight belong
 * to `usePathCompletion`, because enter has to mean one thing and the form is
 * where the other meaning of enter already lives.
 */
export function FilePeek({
	entries,
	highlight,
	onPick,
}: {
	entries: DirEntry[];
	/** the row enter would take, or null when nothing is offered */
	highlight: number | null;
	/** the picked directory, absolute — usually the field's next value */
	onPick: (path: string) => void;
}) {
	if (entries.length === 0) {
		return (
			<text
				selectable={false}
				style={{ width: "100%", flexShrink: 0, marginTop: 1, fg: theme.faint }}
			>
				{"  nothing to show here"}
			</text>
		);
	}

	const shown = entries.slice(0, ROWS);
	const rest = entries.length - shown.length;

	return (
		<box
			style={{
				width: "100%",
				flexShrink: 0,
				marginTop: 1,
				flexDirection: "column",
				backgroundColor: theme.panel,
			}}
		>
			{shown.map((entry, position) => {
				const active = position === highlight;

				return (
					<PressableText
						key={entry.path}
						onPress={() => onPick(entry.path)}
						background={active ? theme.lineActive : theme.panel}
						// the highlighted row keeps its colour under the pointer: the
						// highlight is what enter takes, and dimming it to say the mouse
						// is here would answer a smaller question with a wrong one
						hover={active ? theme.lineActive : theme.hover}
						style={{ width: "100%", flexShrink: 0 }}
					>
						<span style={{ fg: active ? theme.accent : theme.faint }}>
							{active ? "▸ " : "  "}
						</span>
						<span style={{ fg: active ? theme.text : theme.muted }}>
							{entry.repo ? entry.name.padEnd(NAME_COLUMN) : entry.name}
						</span>
						{/* the marker earns its place: you are picking a repository, and
						    this is the column that says which of these is one */}
						{entry.repo ? <span style={{ fg: theme.ok }}>git</span> : null}
					</PressableText>
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
