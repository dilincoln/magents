import { useTerminalDimensions } from "@opentui/react";
import { Fragment } from "react";
import { openAddGroup } from "../actions/open-add-group";
import { openEditGroup } from "../actions/open-edit-group";
import { openHibernateSession } from "../actions/open-hibernate-session";
import { openMoveSession } from "../actions/open-move-session";
import { openRemoveGroup } from "../actions/open-remove-group";
import { openRemoveProject } from "../actions/open-remove-project";
import { openRemoveSession } from "../actions/open-remove-session";
import { openRenameSession } from "../actions/open-rename-session";
import { toggleHelp } from "../actions/toggle-help";
import { USER_AGENTS_PATH } from "../lib/agents";
import type { Row } from "../lib/roster";
import { summarize } from "../lib/roster";
import {
	hibernatable,
	startable,
	startTerminal,
	useAttachStatus,
} from "../lib/session-terminals";
import { theme } from "../lib/theme";
import {
	sessionsIn,
	useAppStore,
	useSelectedRow,
	useVisibleRows,
	useVisibleSections,
} from "../store/use-app-store";
import { DaemonStatus } from "./daemon-status";
import { PressableText } from "./ui/pressable";
import { Wordmark } from "./wordmark";

export function Header() {
	const query = useAppStore((state) => state.query);
	const rows = useVisibleRows();
	// sessions, not agents: they are what the roster is made of now, and a count
	// of a kind of row that no longer appears is a number that can only be wrong
	const count = rows.filter((row) => row.kind === "session").length;
	const projects = useVisibleSections().filter(
		(section) => section.project,
	).length;

	// what is selected, said in as much of full as there is room for. The roster
	// has twenty-six columns and clips everything; this line has the rest of the
	// width, which is a real number and not an unlimited one — see `room`.
	const row = useSelectedRow();
	const session = row?.kind === "session" ? row.session : null;
	const space = room(useTerminalDimensions().width);

	// the same subscription the footer holds, for the same two words: `start` on
	// a session with nothing running, `hibernate` on one with something
	const status = useAttachStatus((state) =>
		session ? state.status[session.id] : undefined,
	);

	/*
	 * What can be done to the selected row, as words beside `? keys`. These are
	 * the clicks the roster used to carry — the `×` on every project and
	 * session — moved here and named, because a destructive target on the two
	 * rightmost columns of every row in a list is a lot of chances for a stray
	 * click, and "×" never said which of the two rows under the pointer it
	 * belonged to. One place, spelled out, about the row the header is already
	 * describing. Each one opens the same panel its chord opens, asking first
	 * where asking is due.
	 */
	const actions =
		row?.kind === "project"
			? [
					// `⌃g` had no mouse anywhere; spawning already has its own row in
					// the roster, so it is the one project act not repeated here
					{ label: "add group", open: () => openAddGroup(row.project) },
					{
						label: "delete project",
						open: () => openRemoveProject(row.project),
					},
				]
			: row?.kind === "group"
				? [
						// fold is the click on the row itself, and reorder is `⇧↑↓` — a
						// direction, which a single click cannot say — so the two panels
						// are the whole of what a bucket offers here
						{ label: "edit group", open: () => openEditGroup(row.group) },
						{
							label: "delete group",
							open: () => openRemoveGroup(row.group, sessionsIn(row.group.id)),
						},
					]
				: row?.kind === "session"
					? [
							{
								label: "rename session",
								open: () => openRenameSession(row.session),
							},
							{
								label: "change group",
								open: () => openMoveSession(row.session),
							},
							// one of these at most, and sometimes neither — `connecting`
							// is a moment when neither claim is true, and the footer
							// already tells the same two truths with the same two guards
							...(startable(status)
								? [
										{
											label: "start session",
											open: () => startTerminal(row.session.id),
										},
									]
								: []),
							...(hibernatable(status)
								? [
										{
											label: "hibernate session",
											open: () => openHibernateSession(row.session),
										},
									]
								: []),
							{
								label: "delete session",
								open: () => openRemoveSession(row.session),
							},
						]
					: [];

	/*
	 * As many as fit, dropped whole from the left when the terminal is too
	 * narrow: half a word is not a button, and the rightmost words are the ones
	 * that must survive — `delete` is the `×` this line replaced, and `? keys`
	 * is the line's one permanent tenant. Three columns per separator, measured
	 * against the same budget the name above answers to.
	 */
	const wanted = (list: typeof actions) =>
		list.reduce(
			(sum, action) => sum + action.label.length + 3,
			"? keys".length,
		);
	const offered = actions.slice();
	while (offered.length > 0 && wanted(offered) > space) offered.shift();

	return (
		<box
			style={{
				width: "100%",
				height: 4,
				flexShrink: 0,
				flexDirection: "row",
				alignItems: "center",
				paddingLeft: 2,
				paddingRight: 2,
				backgroundColor: theme.panel,
				// the backstop under `room` below: if that estimate is ever a few
				// columns generous, the name is cut off rather than the header
				// growing a third row
				overflow: "hidden",
				// and no border, which is not only a matter of taste — there are no
				// borders anywhere else in this app, the seam between the panes is a
				// change of background. A `borderColor` on its own is enough to draw
				// one, which is what used to be here under a commented-out `border`,
				// and a border on a box that clips takes the last row inside it out
				// of the mouse's reach: the hit test is not offset by the border the
				// way the paint is, so the bottom content row answers as the box
				// itself. `? keys` lives on exactly that row, which is why it had no
				// hover and did nothing when pressed.
			}}
		>
			<Wordmark />

			{/*
			 * Two rows rather than one text with a newline in it: the status dot
			 * has its own colour and its own click, and a span inside a text
			 * cannot carry either.
			 */}
			<box
				style={{
					marginLeft: 3,
					flexGrow: 1,
					flexShrink: 1,
					flexDirection: "column",
				}}
			>
				<box
					style={{
						flexShrink: 0,
						flexDirection: "row",
					}}
				>
					<text selectable={false} style={{ flexShrink: 0, fg: theme.faint }}>
						{"│ "}
					</text>
					<DaemonStatus />
					{/* never shrinks: it is nineteen columns of fixed words, and letting
					    it give way is what put "plane" on its own line the first time a
					    session name — which can be a sentence — moved into the column
					    on the right */}
					<text selectable={false} style={{ flexShrink: 0, fg: theme.muted }}>
						agent control plane
					</text>
				</box>

				<text selectable={false} style={{ flexShrink: 0 }}>
					<span style={{ fg: theme.faint }}>│ </span>
					<span style={{ fg: theme.faint }}>
						{summarize(count, projects, query)}
					</span>
				</text>
			</box>

			<box
				style={{
					flexShrink: 0,
					flexDirection: "column",
					alignItems: "flex-end",
				}}
			>
				{/*
				 * A session's or a group's name, and pressing it is how you change it
				 * — the same panel `⌃t` opens. They are the two rows with a name that
				 * is anybody's to edit, so they are the two worth making clickable,
				 * and this is where the name is already written in full.
				 *
				 * A project or an agent gets a caption instead, because there is
				 * nothing here to change: a project's name is its folder, by a rule
				 * that exists so the two cannot disagree.
				 */}
				{space > 0 ? (
					<PressableText
						onPress={
							session
								? () => openRenameSession(session)
								: row?.kind === "group"
									? () => openEditGroup(row.group)
									: undefined
						}
						style={{ flexShrink: 0 }}
					>
						{/* bold, because the action words directly under it are in the
						    same muted ink — weight is what says one line is a name and
						    the other is verbs */}
						<b style={{ fg: theme.muted }}>{clamp(summaryOfRow(row), space)}</b>
					</PressableText>
				) : null}

				<box style={{ flexShrink: 0, flexDirection: "row" }}>
					{offered.map((action) => (
						<Fragment key={action.label}>
							<PressableText
								onPress={action.open}
								style={{ flexShrink: 0, fg: theme.muted }}
							>
								{action.label}
							</PressableText>
							{/* between actions and before `? keys`: a dot joins likes, the
							    bar separates the row's verbs from the button that is always
							    here — the shapes in the footer, for the same grammar */}
							<text
								selectable={false}
								style={{ flexShrink: 0, fg: theme.faint }}
							>
								{action === offered[offered.length - 1] ? " | " : " · "}
							</text>
						</Fragment>
					))}

					<PressableText
						// the button is the label: clicking it does what it says, which
						// is what makes it more than a caption
						onPress={toggleHelp}
						style={{ flexShrink: 0 }}
					>
						<span style={{ fg: theme.accent }}>?</span>
						<span style={{ fg: theme.faint }}> keys</span>
					</PressableText>
				</box>
			</box>
		</box>
	);
}

/**
 * A project is its own path; an agent has only the one place agents live.
 *
 * A session is its name, and nothing else. It used to be the provider and the
 * model, which was defensible and turned out to be answering a question nobody
 * had: the provider is already a coloured mark on the row, the model is not
 * something anyone looks up mid-read, and neither of them says which of five
 * open conversations you are in. The name does — and the roster only ever shows
 * the first nineteen characters of it, so this is the one place it can be read
 * whole. That is reason enough for the line.
 */
/**
 * Everything to the left of this column: the padding, the wordmark and its
 * margin, and the widest the tagline block gets.
 *
 * A number rather than a layout rule, because the two neighbours cannot both
 * give way and neither one can be the one that does. The tagline is fixed words
 * and wrapping it puts "plane" on a line of its own; this column is two rows
 * tall and wrapping it pushes `? keys` out of the header. So the text is cut to
 * fit instead, and fitting means knowing the number.
 *
 * Read off rendered frames at four widths rather than added up from the
 * source: a wordmark built from block glyphs, a margin and two paddings are
 * three chances to be out by one, and being out by one here is a name printed
 * over the top of the tagline. It is a column generous now that the border is
 * gone, which costs the name one character and nothing else.
 */
const TAKEN = 66;

/**
 * What is left for the name — nothing, when there is not enough to be worth it.
 *
 * Below about a dozen columns this is an ellipsis with a letter in front of it,
 * which is not a name, and the space is better spent not overlapping the words
 * next to it. A narrow terminal gets a header with no path on it, which is the
 * honest version of not having room for one.
 */
const room = (width: number): number => {
	const left = width - TAKEN;
	return left >= 12 ? left : 0;
};

/**
 * One line, cut at the character with the cut marked.
 *
 * Cut rather than wrapped, because this column is two rows tall and both of
 * them are spoken for: a name that wrapped would push the `? keys` under it out
 * of the header entirely.
 */
const clamp = (text: string, at: number): string =>
	text.length <= at ? text : `${text.slice(0, at - 1)}…`;

const summaryOfRow = (row: Row | undefined): string => {
	if (!row) return "";
	if (row.kind === "project") return row.project.path;
	// the group's name, not the agents path it used to fall through to: the
	// fallback below is for agent rows, and a bucket is not one
	if (row.kind === "group") return row.group.title;
	if (row.kind === "session") return row.session.title;
	return USER_AGENTS_PATH;
};
