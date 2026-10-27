import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useRef } from "react";
import type { Group } from "../../daemon/db/schema";
import type { LiveSession as Session } from "../../daemon/services/terminals";
import { toggleGroup } from "../actions/toggle-group";
import { useFrame } from "../hooks/use-frame";
import type { Agent } from "../lib/agents";
import { providers } from "../lib/agents";
import { pulse } from "../lib/attention-pulse";
import type { Section } from "../lib/roster";
import { theme } from "../lib/theme";
import { useAppStore, useVisibleSections } from "../store/use-app-store";
import { useSidebarStore } from "../store/use-sidebar-store";
import { SpawnSessionButton } from "./spawn-session-button";
import { Badge } from "./ui/badge";
import { Pressable, PressableText } from "./ui/pressable";
import { ProviderMark } from "./ui/provider-mark";

/** what the sidebar's padding takes before a row gets any of it */
const CHROME = 4;

/**
 * What a row the cursor can land on is called, for the renderer.
 *
 * Its index in the flat paint order, which is the one name the cursor and the
 * row already share: the store keeps an index, `flatten` hands the same index
 * to whatever it draws at that position, and `scrollChildIntoView` takes a
 * name. So the name is the index, and following the cursor is asking the box
 * for the row called what the cursor says.
 */
const rowId = (index: number): string => `roster-row-${index}`;

/**
 * How much of a row is text, given how wide the sidebar has been dragged.
 *
 * These were three constants pinned to a sidebar that was always thirty columns
 * wide. They are the reason the sidebar is worth resizing at all — widening it
 * without widening these would give the list more room and go on clipping every
 * title at nineteen characters, which is a drag that does nothing.
 */
const budget = (width: number) => {
	const row = Math.max(1, width - CHROME);

	return {
		row,
		/** longest name shown in full; the column is one wider so it never touches the badge */
		nameMax: Math.max(4, row - 13),
		/** a session title gets the rest of the row, less the marker and the mark */
		titleMax: Math.max(4, row - 5),
	};
};

function Row({
	agent,
	active,
	index,
	width,
}: {
	agent: Agent;
	active: boolean;
	index: number;
	width: number;
}) {
	const { row: ROW_WIDTH, nameMax: NAME_MAX } = budget(width);
	const NAME_WIDTH = NAME_MAX + 1;

	const badge = `◆ ${providers[agent.provider].label}`;
	const name =
		agent.name.length > NAME_MAX
			? `${agent.name.slice(0, NAME_MAX - 1)}… `
			: agent.name.padEnd(NAME_WIDTH);
	// pad to the full row so the selected background spans the whole line
	const trail = " ".repeat(
		Math.max(0, ROW_WIDTH - 2 - NAME_WIDTH - badge.length),
	);

	return (
		<PressableText
			id={rowId(index)}
			onPress={() => useAppStore.getState().setCursor(index)}
			background={active ? theme.lineActive : theme.panel}
			// the selected row is left alone: the cursor is what the keys act on,
			// and a hover that dimmed it would be the louder of two claims and the
			// wrong one
			hover={active ? theme.lineActive : theme.hover}
			style={{ width: "100%", flexShrink: 0 }}
		>
			<span style={{ fg: active ? theme.accent : theme.panel }}>▎ </span>
			{active ? (
				<b style={{ fg: theme.text }}>{name}</b>
			) : (
				<span style={{ fg: theme.muted }}>{name}</span>
			)}
			<Badge provider={agent.provider} />
			<span>{trail}</span>
		</PressableText>
	);
}

/**
 * An open conversation, under the project it was opened in.
 *
 * Its title is the first line of what was asked, because that is the only text
 * a session has that a person wrote — everything else about it lives inside the
 * CLI and comes back by resuming it.
 *
 * Its mark is filled while a process is running, and that is now the only way
 * to know a background agent exists at all — including one this process never
 * started and has never had a pane open on. Sessions outlive the window they
 * were opened in, so the list is the only place their liveness can be read;
 * otherwise a running agent is a thing you have to remember you started, in a
 * previous run of the program.
 */
/**
 * What a session that is still being opened shows in its gutter.
 *
 * Two columns wide, which is the whole reason it fits where it fits — see
 * `opening` below. Named rather than inline so the width claim and the glyph
 * cannot drift apart: another emoji here is fine, a one-column character is
 * not, and neither is one of the emoji that render narrow without a variation
 * selector.
 */
const OPENING = "🔥";

function SessionRow({
	session,
	active,
	index,
	width,
	indent = 0,
}: {
	session: Session;
	active: boolean;
	index: number;
	/** the sidebar's, so the title is clipped to what is actually on screen */
	width: number;
	/**
	 * Columns of blank before the gutter, which is what puts a session inside a
	 * bucket rather than beside one.
	 *
	 * Taken off the title's budget as well as added to the front. A row that is
	 * indented without being clipped harder is a row that overflows by exactly
	 * the amount it was moved, and the sidebar is narrow enough that four
	 * columns is the difference between a name and an ellipsis.
	 */
	indent?: number;
}) {
	const TITLE_MAX = Math.max(4, budget(width).titleMax - indent);

	const title =
		session.title.length > TITLE_MAX
			? `${session.title.slice(0, TITLE_MAX - 1)}…`
			: session.title;

	/*
	 * The daemon's own registry, overlaid on the row and refreshed on the
	 * heartbeat — so this covers sessions this process never started, which is
	 * the state the whole change exists to create. It is slower than the store
	 * it replaced, by up to a beat and a half; the attach socket carries the
	 * fast half for the pane actually on screen.
	 *
	 * `state` and not `pid`, because a pid cannot say "coming up": there is no
	 * process at all while a provider settles, so a mark read off the pid alone
	 * paints a session that was opened successfully as dead.
	 */
	const running = session.state === "running";

	/*
	 * Coming up, and it says so in the gutter rather than in the mark.
	 *
	 * `starting` used to be folded into `running` above, which was right while it
	 * meant codex's two-second settling window. It does not any more: codex will
	 * not save a resumable session until the first turn has finished, so
	 * `openSession` answers immediately and leaves the row here for however long
	 * the work takes — two minutes and eight seconds, on the run that prompted
	 * this. A filled mark makes a specific promise over that window and breaks
	 * it: it says `⌃r` picks the agent up mid-sentence, and `⌃r` on a session
	 * still opening is refused as already running.
	 *
	 * Which leaves the mark telling the truth on its own — hollow, because there
	 * is genuinely no process — and the fire is what stops hollow reading as
	 * dead. The two together are the whole sentence: nothing behind it yet, and
	 * something on the way.
	 *
	 * It goes in the gutter, and that part is arithmetic. An emoji is two
	 * columns; the cursor bar is one and the padding after it is one, so the
	 * fire fits exactly where they were and every mark in the list stays in its
	 * column. Adding rather than substituting would push this row a column right
	 * of the list it is in.
	 *
	 * What it costs is the bar on this row while it opens. The bar is invisible
	 * on an unselected row anyway — it is painted in the panel colour — and on
	 * the selected one the row's own background is still saying where the cursor
	 * is, so what is lost is an affordance rather than the information.
	 */
	const opening = session.state === "starting";

	/*
	 * The wash over a row that wants somebody, written straight onto the box.
	 *
	 * Through a ref and a frame callback rather than through a prop, for the
	 * reason the wordmark gives: a colour that changes every frame as state is
	 * sixty renders a second of the whole list. The clock is this row's own, so
	 * rows lit at different moments breathe out of step — which is what they
	 * are, two different things asking, rather than one thing blinking.
	 *
	 * It wins over the hover while it runs, and that is a decision rather than
	 * an oversight: the pointer resting on a row is a small claim about the
	 * future and the pulse is a claim about the present, and the row is going to
	 * stop pulsing the moment the click lands anyway.
	 */
	const box = useRef<BoxRenderable>(null);
	const age = useRef(0);

	useFrame((dt) => {
		age.current += dt;
		if (box.current) box.current.backgroundColor = pulse(age.current);
	}, session.requiresAttention);

	return (
		<Pressable
			ref={box}
			id={rowId(index)}
			onPress={() => useAppStore.getState().setCursor(index)}
			background={active ? theme.lineActive : theme.panel}
			hover={active ? theme.lineActive : theme.hover}
			style={{
				width: "100%",
				flexShrink: 0,
				flexDirection: "row",
			}}
		>
			<text selectable={false} style={{ flexGrow: 1, flexShrink: 1 }}>
				{indent > 0 ? <span>{" ".repeat(indent)}</span> : null}
				{opening ? (
					<span>{OPENING}</span>
				) : (
					<span style={{ fg: active ? theme.accent : theme.panel }}>▎ </span>
				)}
				<ProviderMark provider={session.provider} live={running} />
				{active ? (
					<b style={{ fg: theme.text }}>{` ${title}`}</b>
				) : (
					<span style={{ fg: theme.muted }}>{` ${title}`}</span>
				)}
			</text>
		</Pressable>
	);
}

/**
 * A bucket's heading: fold, mark, name, count.
 *
 * Indented two columns under its project and putting its own name where a
 * session's mark will go, so the tree reads as a tree without any lines drawn:
 * a child's glyph sits under its parent's first letter, one level down. That
 * rule was already true of a session under a project; this is the same rule
 * applied twice.
 *
 * The fold arrow is also the mark: it is drawn in the accent on the project's
 * default — where new sessions are born — and in violet on every other bucket.
 * That fact used to have a glyph of its own, `▰` beside `▾`, which is two
 * columns of a twenty-six column row spent on one bit of information, in the
 * column where a session shows its provider. A colour on a glyph that has to be
 * there anyway costs nothing and is read faster than a second shape.
 *
 * Which means the arrow no longer changes under the cursor. It did, and it
 * cannot now: the selected row is already a lighter background with its title
 * in bold, and an arrow that went accent on selection would say "default" about
 * whichever bucket you happened to be standing on. Selection is a thing you are
 * doing; being the default is a thing the group is.
 *
 * *auto-hibernate* before the count is the bucket's other fact: it stops the
 * agent of anything moved into it. Spelled out in words where being the default
 * gets a colour, because it is not a state of the bucket — it is a rule about
 * what arriving there does, and a mark for that is a thing you have to have
 * been told about before it tells you anything.
 *
 * No `×`, and no longer alone in that: no row has one. They lived on the two
 * rightmost columns of every project and session, which put a destructive
 * target under the most casual part of the screen — see the header, where the
 * actions for whatever is selected now live, each still asking first.
 */
/** What a bucket that sleeps its arrivals wears, in full. */
const AUTO_HIBERNATE = "auto-hibernate";

function GroupRow({
	group,
	count,
	shut,
	index,
	active,
	width,
}: {
	group: Group;
	/** how many sessions are inside, shown whether or not they are drawn */
	count: number;
	shut: boolean;
	index: number;
	active: boolean;
	width: number;
}) {
	// two for the indent, two for the fold, the count and its column on the
	// right — the same arithmetic `budget` does for a session — and the word on
	// the right when there is one, which is most of a narrow sidebar and has to
	// come off the title rather than push it through the count. Two columns
	// wider than it was, which is the default glyph that used to sit here.
	const TITLE_MAX = Math.max(
		4,
		budget(width).titleMax - 2 - (group.hibernates ? AUTO_HIBERNATE.length : 0),
	);

	const title =
		group.title.length > TITLE_MAX
			? `${group.title.slice(0, TITLE_MAX - 1)}…`
			: group.title;

	return (
		<Pressable
			// Selecting and folding are one click here, unlike everywhere else in
			// this file where the second intention gets its own target. A heading
			// with nothing under it to point at has only the one thing it can mean,
			// and making somebody select it first to then press a key would be two
			// steps for the only action it has.
			id={rowId(index)}
			onPress={() => {
				useAppStore.getState().setCursor(index);
				toggleGroup(group);
			}}
			background={active ? theme.lineActive : theme.panel}
			hover={active ? theme.lineActive : theme.hover}
			style={{ width: "100%", flexShrink: 0, flexDirection: "row" }}
		>
			<text selectable={false} style={{ flexGrow: 1, flexShrink: 1 }}>
				<span>{"  "}</span>
				<span style={{ fg: group.isDefault ? theme.accent : theme.violet }}>
					{shut ? "▸ " : "▾ "}
				</span>
				{active ? (
					<b style={{ fg: theme.text }}>{title}</b>
				) : (
					<span style={{ fg: theme.muted }}>{title}</span>
				)}
			</text>

			{/* spent only where there is something to say, and said in words. It
			    is the one thing on this row that is a rule rather than a place,
			    and italic is what keeps a whole word from reading as part of the
			    title next to it. */}
			<text selectable={false} style={{ flexShrink: 0 }}>
				{group.hibernates ? (
					<i style={{ fg: theme.faint }}>{`${AUTO_HIBERNATE} `}</i>
				) : (
					""
				)}
			</text>

			<text selectable={false} style={{ flexShrink: 0, fg: theme.faint }}>
				{String(count)}
			</text>
		</Pressable>
	);
}

/**
 * The repo folder and how many agents it holds. The full path is in the header.
 *
 * A registered project's heading is a row the cursor can land on — it is the
 * project, and anything said about a project is said here. A seeded section's
 * heading is a label: there is nothing behind it to select.
 *
 * Nothing destructive on the row itself: removing a project is `⌃d`, or the
 * `delete project` action the header offers while one is selected.
 */
function ProjectHeader({
	section,
	index,
	active,
}: {
	section: Section;
	/** where this heading sits in the flat list, when it is selectable */
	index: number | null;
	active: boolean;
}) {
	return (
		<Pressable
			// a seeded group's heading is a label, and a label that lit up under the
			// pointer would be promising a click it does not have — the primitive
			// ties the two together, so passing no handler also passes no highlight
			id={index === null ? undefined : rowId(index)}
			onPress={
				index === null
					? undefined
					: () => useAppStore.getState().setCursor(index)
			}
			background={active ? theme.lineActive : theme.panel}
			hover={active ? theme.lineActive : theme.hover}
			style={{
				width: "100%",
				flexShrink: 0,
				flexDirection: "row",
			}}
		>
			<text selectable={false} style={{ flexGrow: 1, flexShrink: 1 }}>
				{/* violet whether or not it is selected, because the accent on an
				    arrow now means one thing in this list and it is not selection:
				    the group it points at is where new sessions land. Selection is
				    the lighter background under the whole row. */}
				<span style={{ fg: theme.violet }}>▾ </span>
				<b style={{ fg: theme.text }}>{section.label}</b>
			</text>

			<text selectable={false} style={{ flexShrink: 0, fg: theme.faint }}>
				{/* everything under it, buckets included — a project that counted only
				    its loose sessions would say 0 over a full tree */}
				{String(
					section.sessions.length +
						section.agents.length +
						section.buckets.reduce(
							(total, bucket) => total + bucket.sessions.length,
							0,
						),
				)}
			</text>
		</Pressable>
	);
}

export function Roster() {
	const sections = useVisibleSections();
	const cursor = useAppStore((state) => state.cursor);
	const query = useAppStore((state) => state.query);
	const width = useSidebarStore((state) => state.width);

	/*
	 * Where each row lands in the flat paint order.
	 *
	 * The cursor is an index into `flatten`'s list, so this walk has to count
	 * exactly what `flatten` counts, in exactly its order: the project heading,
	 * then each bucket's heading and — unless it is folded — its sessions, then
	 * the sessions in no bucket, then the agents. The two orders being the same
	 * is not a convention anybody can check at compile time, which is why they
	 * are written to look alike.
	 *
	 * `query` overrules a fold in both places for the same reason: a match
	 * hidden inside something closed an hour ago is a search that answered
	 * wrongly.
	 */
	let next = 0;
	const blocks = sections.map((section) => {
		const heading = section.project ? next++ : null;

		const buckets = section.buckets.map((bucket) => {
			const at = next++;
			const open = Boolean(query) || !bucket.group.collapsed;
			const sessions = next;
			if (open) next += bucket.sessions.length;
			return { bucket, at, open, sessions };
		});

		const loose = next;
		next += section.sessions.length;
		const agents = next;
		next += section.agents.length;

		return { section, heading, buckets, loose, agents };
	});

	/*
	 * The list scrolls, and the cursor is what it scrolls to.
	 *
	 * It did not, for a long time: the sidebar clipped the roster at the bottom
	 * and the wheel moved the selection, which was fine while every session fit
	 * on a screen and wrong the day they stopped — a row below the fold could
	 * be selected and acted on and never seen. So the roster is a viewport now,
	 * and it follows the cursor rather than the other way round: keys move the
	 * selection and the list moves to keep it on screen, the wheel moves the
	 * list and leaves the selection where it was.
	 *
	 * `scrollChildIntoView` does the arithmetic, by the row's name, and finds it
	 * however deep it sits — a session inside a bucket inside a project is
	 * three boxes down and it does not matter. What it reads are laid-out
	 * positions, which is why this runs on the frame after the change rather
	 * than in the effect that notices it: the effect fires when React is done,
	 * and layout is done a frame later. Two frames, because a fold or an
	 * arrival can move the row itself between the first and the second, and a
	 * second look costs nothing.
	 */
	const box = useRef<ScrollBoxRenderable>(null);
	const follow = useRef(0);

	// `next` is the row count: a list that grew or folded moves rows under a
	// cursor that did not itself move
	// biome-ignore lint/correctness/useExhaustiveDependencies: the effect exists to run when these change, not to read them
	useEffect(() => {
		follow.current = 2;
	}, [cursor, next]);

	useFrame(() => {
		if (follow.current <= 0) return;
		follow.current -= 1;
		box.current?.scrollChildIntoView(rowId(cursor));
	});

	// Nothing to say when empty: the count under the wordmark already says
	// "no matches", and the search field still holds the query that came up dry.
	return (
		<scrollbox
			ref={box}
			style={{
				width: "100%",
				flexGrow: 1,
				flexShrink: 1,
				backgroundColor: theme.panel,
				scrollY: true,
				scrollX: false,
				// the top, not the bottom: this is a list somebody is reading down,
				// not a log that is being appended to
				stickyScroll: false,
				// no bar: the sidebar is narrow and a track down its edge would be
				// a column taken from every title for a fact the selection already
				// tells — there is more below when the cursor keeps going
				verticalScrollbarOptions: { visible: false },
				contentOptions: { flexDirection: "column", width: "100%" },
			}}
		>
			{blocks.map(({ section, heading, buckets, loose, agents }) => (
				<box
					key={section.key}
					style={{
						width: "100%",
						flexShrink: 0,
						flexDirection: "column",
						marginBottom: 1,
						backgroundColor: theme.panel,
					}}
				>
					<ProjectHeader
						section={section}
						index={heading}
						active={heading === cursor}
					/>

					{buckets.map(({ bucket, at, open, sessions }) => (
						<box
							key={bucket.group.id}
							style={{ width: "100%", flexShrink: 0, flexDirection: "column" }}
						>
							<GroupRow
								group={bucket.group}
								count={bucket.sessions.length}
								shut={!open}
								index={at}
								active={at === cursor}
								width={width}
							/>

							{open
								? bucket.sessions.map((session, position) => (
										<SessionRow
											key={session.id}
											session={session}
											index={sessions + position}
											active={sessions + position === cursor}
											width={width}
											indent={GROUP_INDENT}
										/>
									))
								: null}
						</box>
					))}

					{section.sessions.map((session, position) => (
						<SessionRow
							key={session.id}
							session={session}
							index={loose + position}
							active={loose + position === cursor}
							width={width}
						/>
					))}

					{section.agents.map((agent, position) => (
						<Row
							key={agent.id}
							agent={agent}
							index={agents + position}
							active={agents + position === cursor}
							width={width}
						/>
					))}

					{/*
					 * Under the project, always — with agents above it or with nothing
					 * above it. It replaced a "no agents yet" line: the heading already
					 * shows a count of zero, and two lines saying the same thing under
					 * every empty project is one line of clutter per project.
					 */}
					{section.project ? (
						<SpawnSessionButton project={section.project} />
					) : null}
				</box>
			))}
		</scrollbox>
	);
}

/**
 * How far a session inside a bucket sits from one that is not.
 *
 * Four, and it is arithmetic rather than taste: a group heading spends two
 * columns on its own indent and two on its fold arrow, so its mark lands on
 * column four and its title on six. A session indented by four puts *its* mark
 * on six — under the group's title, the same way a loose session's mark sits
 * under its project's title. One rule, applied at both depths.
 */
const GROUP_INDENT = 4;
