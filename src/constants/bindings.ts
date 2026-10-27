import type { CliRenderer } from "@opentui/core";
import { openAddGroup } from "../actions/open-add-group";
import { openAddProject } from "../actions/open-add-project";
import { openEditGroup } from "../actions/open-edit-group";
import { openHelp } from "../actions/open-help";
import { openHibernateSession } from "../actions/open-hibernate-session";
import { openImportSession } from "../actions/open-import-session";
import { openMoveSession } from "../actions/open-move-session";
import { openRemoveGroup } from "../actions/open-remove-group";
import { openRemoveProject } from "../actions/open-remove-project";
import { openRemoveSession } from "../actions/open-remove-session";
import { openRenameSession } from "../actions/open-rename-session";
import { openSpawnSession } from "../actions/open-spawn-session";
import { quit } from "../actions/quit";
import { reorderGroup } from "../actions/reorder-group";
import { toggleGroup } from "../actions/toggle-group";
import { toggleSidebar } from "../actions/toggle-sidebar";
import {
	hibernatable,
	startTerminal,
	useAttachStatus,
} from "../lib/session-terminals";
import {
	selectedProject,
	selectedRow,
	sessionsIn,
	useAppStore,
} from "../store/use-app-store";
import { useSidebarStore } from "../store/use-sidebar-store";

/**
 * How far one press moves the seam.
 *
 * A single column is four presses to notice anything and twenty to get
 * anywhere; four overshoots the width somebody was aiming for. Two is the one
 * that lands.
 */
const STEP = 2;

export interface Binding {
	/**
	 * What `KeyEvent.name` has to match. Plural because several keys can mean
	 * the same thing.
	 */
	readonly keys: readonly string[];
	/**
	 * Whether it is held with control. A chord, unlike a bare letter, is safe to
	 * press while typing, and the screen lets it through from anywhere.
	 */
	readonly ctrl?: boolean;
	/**
	 * Whether alt is held as well — only ever beside `ctrl`, and only on the
	 * width keys. They need the second modifier because `⌃←` and `⌃→` on their
	 * own are the word jumps inside claude and codex, and a chord this screen
	 * takes while attached is one the agent never sees. The parser reports alt
	 * as `meta`, which is what this is matched against.
	 */
	readonly alt?: boolean;
	/**
	 * What the same key looks like on a terminal that cannot spell the chord.
	 *
	 * There is one of these and it exists because `⌃i` and tab are the same
	 * byte. A terminal that grants kitty disambiguation sends `\u001b[105;5u`
	 * for the chord and `\t` for the key, and the two are told apart; one that
	 * does not sends `\t` for both, and `⌃i` arrives here named `tab`.
	 *
	 * So this is not an alias anyone chose. It is the same keystroke under the
	 * name the terminal had for it, which is why it is a field on the binding
	 * rather than a second row: the key list shows one key, because there is
	 * one.
	 */
	readonly fallback?: readonly string[];
	/**
	 * Whether it is held with shift.
	 *
	 * Only arrows carry this, and it earns its own field rather than a second
	 * entry in `keys` because a shifted arrow arrives under the *same* name as a
	 * bare one — `up` with `shift: true`, measured through the same parser the
	 * renderer uses. So the two cannot be told apart by name, which is exactly
	 * what `keys` matches on.
	 */
	readonly shift?: boolean;
	/** how it is written in the key list */
	readonly label: string;
	readonly description: string;
	/** what it does, once */
	readonly run: (renderer: CliRenderer) => void;
}

/**
 * The keyboard, in one table. Array order is the order the key list shows.
 *
 * These are the bindings that apply when the roster has the keyboard. The
 * search and a modal each answer for their own keys before this is reached —
 * see `keyboard-owner.ts` — which is why `esc` here is the roster's escape and
 * not the search's.
 *
 * The point of the table is that a row cannot lie: the sentence in the key list
 * and the behaviour it describes are the same row. They used to be two files.
 */
export const bindings: readonly Binding[] = [
	{
		keys: ["/"],
		label: "/",
		description: "search sessions, projects, providers, models",
		// the field is in the sidebar, so a search asked for with the sidebar
		// hidden brings it back rather than typing into nothing
		run: () => {
			useSidebarStore.getState().show();
			useAppStore.getState().focusSearch();
		},
	},
	{
		keys: ["up", "k"],
		label: "↑ k",
		description: "move up the roster",
		run: () => useAppStore.getState().moveCursor(-1),
	},
	{
		keys: ["down", "j"],
		label: "↓ j",
		description: "move down the roster",
		run: () => useAppStore.getState().moveCursor(1),
	},
	/*
	 * Two rows for one pair of directions, for the reason `⌃⌥←`/`⌃⌥→` are two: a
	 * row is handed the renderer and not the key that reached it, so one row
	 * could not tell its two directions apart.
	 *
	 * Shift-arrows rather than a chord, and that is the second choice again.
	 * `⌃k`/`⌃j` are the letters that would match `k`/`j` moving the cursor, and
	 * `⌃j` is 0x0A — a line feed, which a terminal without kitty disambiguation
	 * reports under a name of its own, the same trap `⌃m` fell into. Shift with
	 * an arrow has no byte to collide over: it arrives as `up` or `down` with a
	 * modifier flag, in both raw and kitty modes.
	 */
	{
		keys: ["up"],
		shift: true,
		label: "⇧↑",
		description: "move the selected group up its project",
		run: () => reorderGroup(-1),
	},
	{
		keys: ["down"],
		shift: true,
		label: "⇧↓",
		description: "move the selected group down its project",
		run: () => reorderGroup(1),
	},
	{
		keys: ["a"],
		ctrl: true,
		label: "⌃a",
		description: "add a project",
		run: () => openAddProject(),
	},
	{
		keys: ["g"],
		ctrl: true,
		label: "⌃g",
		description: "add a group to the project you are in",
		// Next to `⌃a` because it is the same kind of act one level down: `⌃a`
		// registers a place for sessions to live, this makes a bucket inside one.
		// A session row counts as being in its project, the same as `⌃n` — see
		// `selectedProject`.
		run: () => {
			const project = selectedProject();
			if (project) openAddGroup(project);
		},
	},
	{
		keys: ["i"],
		ctrl: true,
		// see `fallback` on the interface: on a terminal without kitty
		// disambiguation this exact keystroke arrives named `tab`, and tab means
		// nothing else in the roster — inside the search and inside a modal it is
		// answered before this table is reached, which is where completion needs it
		fallback: ["tab"],
		label: "⌃i",
		description: "import a session by the id its provider gave it",
		// Next to `⌃a` rather than to `⌃n`, and global for the same reason it is:
		// what it brings in belongs to whichever folder the conversation ran in,
		// which the transcript names. Where the cursor happens to be standing has
		// no say in it, so standing somewhere in particular is not a condition.
		run: () => openImportSession(),
	},
	{
		keys: ["n"],
		ctrl: true,
		label: "⌃n",
		description: "spawn a session in the project you are in",
		// A session row counts as being in its project — see `selectedProject`.
		// Attached is the one place this does not reach, and not by a check here:
		// a focused terminal is answered before this table is read at all, which
		// is right, because there every key is the agent's.
		run: () => {
			const project = selectedProject();
			if (project) openSpawnSession(project);
		},
	},
	/*
	 * Two rows for one adjustment, because a row is handed the renderer and not
	 * the key that reached it — so a single row could not tell its two
	 * directions apart. Which is a fair reading anyway: narrowing and widening
	 * are two things somebody does, and the key list says so.
	 *
	 * Neither says "only when detached". A focused terminal is answered before
	 * this table is read at all, which is right: there, ⌃⌥← is the way out —
	 * see the terminal branch in the screen — and ⌃⌥→ goes to the agent like
	 * any other key. The description of the first says both, because the key
	 * list has one row per chord and this chord genuinely means two things
	 * depending on where the keyboard is.
	 *
	 * Alt as well as control, and that is the third choice: plain `⌃←`/`⌃→` are
	 * the word jumps inside claude and codex, and attached, `⌃←` was being
	 * taken from the agent to detach. See `alt` on the interface.
	 */
	{
		keys: ["left"],
		ctrl: true,
		alt: true,
		label: "⌃⌥←",
		description: "narrow the sidebar; attached, detach from the session",
		run: (renderer) => useSidebarStore.getState().nudge(-STEP, renderer.width),
	},
	{
		keys: ["right"],
		ctrl: true,
		alt: true,
		label: "⌃⌥→",
		description: "widen the sidebar",
		// the renderer's width, because the ceiling depends on it — see
		// `clampWidth`, which will not let the sidebar push the agent's pane
		// under eighty columns
		run: (renderer) => useSidebarStore.getState().nudge(STEP, renderer.width),
	},
	{
		keys: ["e"],
		ctrl: true,
		label: "⌃e",
		description: "hide or show the sidebar; works attached too",
		/*
		 * Next to the width keys because it is the same knob turned all the way:
		 * the agent's pane gets every column. It is also answered while attached
		 * — see the terminal branch in the screen — because that is where the
		 * room is wanted, and a key that had to detach first would be three
		 * keystrokes for one idea.
		 *
		 * While it is hidden the footer says when a session wants somebody,
		 * since the roster's pulse is the thing that went with it.
		 */
		run: () => toggleSidebar(),
	},
	{
		keys: ["t"],
		ctrl: true,
		label: "⌃t",
		description: "rename a session, edit a group",
		// `t` for title, which is what this changes on a session — `r` was the
		// obvious letter and is already the one that starts an agent.
		run: () => {
			const row = selectedRow();
			if (row?.kind === "session") openRenameSession(row.session);
			// More than a title on a group, because a group has more than one: it
			// is also where new sessions land and whether what arrives there
			// sleeps, and those were only settable at the moment it was made —
			// the moment somebody knows least about it. Projects still refuse
			// entirely: a project's name is derived from its folder on purpose, so
			// that it cannot drift from the directory it claims to be, and a
			// rename would be that drift.
			if (row?.kind === "group") openEditGroup(row.group);
		},
	},
	{
		keys: ["d"],
		ctrl: true,
		label: "⌃d",
		description: "remove what is selected",
		// One key, two things, because it means the same thing on both: remove
		// the row the cursor is on. Nothing happens elsewhere and nothing should
		// — the footer only offers it where it does something.
		run: () => {
			const row = selectedRow();
			if (row?.kind === "project") openRemoveProject(row.project);
			if (row?.kind === "session") openRemoveSession(row.session);
			// The count goes to the panel so it can say what is at stake, which
			// here is nothing: the sessions survive and move up to the project.
			if (row?.kind === "group") {
				openRemoveGroup(row.group, sessionsIn(row.group.id));
			}
		},
	},
	{
		keys: ["r"],
		ctrl: true,
		label: "⌃r",
		description: "start the selected session's agent",
		/*
		 * The only way a session starts other than being opened. Attaching does
		 * not — a daemon that restarted says `never-started` about everything it
		 * holds, and a pane that read that as permission re-ran the resume
		 * command for every session it had ever shown, including the ones stopped
		 * on purpose. So the ask is a key, and `startTerminal` refuses when there
		 * is something already running or when the agents are this process's, in
		 * which case coming back to the pane starts them and always has.
		 */
		run: () => {
			const row = selectedRow();
			if (row?.kind === "session") startTerminal(row.session.id);
		},
	},
	{
		keys: ["h"],
		ctrl: true,
		// The same collision `⌃i` has, measured the same way: with kitty
		// disambiguation `⌃h` arrives as `h` with ctrl, and without it the
		// terminal sends 0x08 — which is `⌃H`, which is backspace, and the parser
		// reports `backspace` with no modifier. Indistinguishable, so the
		// fallback is the keystroke under the name that terminal had for it.
		// Backspace means nothing else in the roster, and what it opens is a
		// question rather than an action.
		fallback: ["backspace"],
		label: "⌃h",
		description: "hibernate the selected session — stop its agent",
		/*
		 * The inverse of `⌃r`, and guarded where `⌃r` is not. `startTerminal`
		 * refuses on its own and returns whether it did anything, so the key can
		 * be pressed at any time and be a no-op; this opens a panel, and a panel
		 * asking whether to stop an agent that is not running is a question with
		 * no true answer. So the state is read first.
		 */
		run: () => {
			const row = selectedRow();
			if (row?.kind !== "session") return;

			const status = useAttachStatus.getState().status[row.session.id];
			if (hibernatable(status)) openHibernateSession(row.session);
		},
	},
	{
		keys: ["b"],
		ctrl: true,
		label: "⌃b",
		description: "move the selected session to a group",
		/*
		 * `b` for bucket, and it is the second choice. `⌃m` is the letter anybody
		 * would reach for and it cannot be used: `⌃m` is 0x0D, which is carriage
		 * return, so on a terminal without kitty disambiguation it arrives named
		 * `return` — the same key that types into a session and folds a group. The
		 * `fallback` field solves that collision for `⌃i` and `⌃h` because `tab`
		 * and `backspace` mean nothing else in the roster; `return` means two
		 * things already, and a third would be a key with no honest answer.
		 *
		 * Sessions only. A group is a place, not a thing that goes in one, and a
		 * panel offering to move a project into a bucket is a question with no
		 * true answer.
		 */
		run: () => {
			const row = selectedRow();
			if (row?.kind === "session") openMoveSession(row.session);
		},
	},
	{
		keys: ["return", "enter"],
		label: "⏎",
		description: "open a session, or fold a group",
		// Two things, and they are the same thing: enter opens what the cursor is
		// on. On a session that means its program, which is the only row with one
		// behind it; on a group heading there is nothing to type at and exactly
		// one thing it can mean. On any other row it still means nothing.
		run: () => {
			const row = selectedRow();
			if (row?.kind === "session") useAppStore.getState().focusTerminal();
			if (row?.kind === "group") toggleGroup(row.group);
		},
	},
	{
		keys: ["right"],
		label: "→",
		description: "attach to the selected session",
		// The other half of `⌃⌥←` above, and the pair is claude's own: its agent
		// view backgrounds on `←` and returns on `→`. Sessions only — a group
		// has nothing to attach to, and folding it on an arrow would make the
		// two arrows mean different kinds of thing.
		run: () => {
			const row = selectedRow();
			if (row?.kind === "session") useAppStore.getState().focusTerminal();
		},
	},
	{
		keys: ["?"],
		label: "?",
		description: "this list",
		run: () => openHelp(),
	},
	{
		keys: ["escape"],
		label: "esc",
		description: "clear the search",
		// esc never leaves the application — `q` and ctrl-c do. It is the key you
		// hit to back out of something, and backing out of nothing is nothing.
		// Guarded rather than unconditional: `clearSearch` also sends the cursor
		// home, which is wrong when there was no search to clear.
		run: () => {
			const state = useAppStore.getState();
			if (state.query) state.clearSearch();
		},
	},
	{
		keys: ["q"],
		label: "q",
		description: "quit",
		run: (renderer) => quit(renderer),
	},
];
