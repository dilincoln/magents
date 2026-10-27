/**
 * The one store. Writes happen on keypress today and will happen from provider
 * adapters later — `useAppStore.setState` works from outside React, so a running
 * agent can push status without a bridge into the component tree.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { create } from "zustand";
import type { Group, Project } from "../../daemon/db/schema";
import type { LiveSession as Session } from "../../daemon/services/terminals";
import { type Agent, seedAgents } from "../lib/agents";
import { buildSections, flatten, type Row, type Section } from "../lib/roster";
import { groupsQuery } from "../queries/groups-query";
import { projectsQuery } from "../queries/projects-query";
import { queryClient } from "../queries/query-client";
import { sessionsQuery } from "../queries/sessions-query";

/**
 * One empty array, not a fresh one per render. `data ?? []` written inline
 * would hand `useMemo` a new identity every time the query has no data and
 * rebuild the whole roster on every render to produce the same thing.
 */
const NONE: Project[] = [];
const NO_SESSIONS: Session[] = [];
const NO_GROUPS: Group[] = [];

/**
 * What has the keyboard when no modal is up. One value, not a flag per widget:
 * two booleans can both be true, and "the roster and the search are both
 * focused" is a state with no meaning that someone would have to handle.
 *
 * Modals are not in here. A modal outranks this rather than replacing it, so
 * closing one hands the keyboard back to whatever was holding it — see
 * `keyboard-owner.ts`.
 */
export type Focus = "roster" | "search" | "terminal";

/**
 * Where the cursor is going, once there is a row to put it on.
 *
 * It used to carry the opening command as well — the one that is not a resume,
 * right exactly once — and that is gone: no command crosses the socket in
 * either direction now, because the daemon runs the provider itself. What is
 * left is purely an intention about the screen. Opening a session is a two-step
 * and the row does not exist for the render that asked for it, so the ask waits
 * here until `use-follow-launch` finds it.
 */
export interface Launch {
	sessionId: string;
}

interface AppState {
	agents: Agent[];
	/** free-text search over every field, ANDed by term */
	query: string;
	focus: Focus;
	/** index into the *visible* list, not into `agents` */
	cursor: number;
	/** waiting to be selected, and then never again */
	launch: Launch | null;

	moveCursor: (delta: number) => void;
	setCursor: (index: number) => void;
	setQuery: (query: string) => void;
	focusSearch: () => void;
	focusRoster: () => void;
	/** hands every key to the embedded terminal until it is taken back */
	focusTerminal: () => void;
	/** a session was just opened: go looking for its row */
	opened: (sessionId: string) => void;
	/** the cursor landed on it; from here on it is a row like any other */
	consumeLaunch: () => void;
	clearSearch: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
	agents: seedAgents,
	query: "",
	focus: "roster",
	cursor: 0,
	launch: null,

	moveCursor: (delta) => {
		const { cursor } = get();
		// counted through the groups, not through the raw selection: the cursor
		// indexes the grouped paint order, so the two must agree exactly
		const count = flatten(visibleSections(), get().query).length;
		if (count === 0) return;
		set({ cursor: (cursor + delta + count) % count });
	},

	// Clicking a row picks it outright, and takes the keyboard while it does:
	// a click is someone pointing at the roster, not at whatever had focus.
	setCursor: (index) => set({ cursor: index, focus: "roster" }),

	// Any change to what is visible sends the cursor home: keeping it would land
	// it on a different agent than the one it was on.
	setQuery: (query) => set({ query, cursor: 0 }),
	focusSearch: () => set({ focus: "search" }),
	focusRoster: () => set({ focus: "roster" }),
	focusTerminal: () => set({ focus: "terminal" }),

	opened: (sessionId) => set({ launch: { sessionId } }),
	consumeLaunch: () => set({ launch: null }),
	clearSearch: () => set({ query: "", cursor: 0, focus: "roster" }),
}));

/**
 * The roster as the screen paints it, for code that runs outside render — key
 * handlers, where there is no hook to call. The hooks below answer the same
 * question for components; both go through `buildGroups`, so the cursor and the
 * paint order cannot drift apart.
 */
export function visibleSections(): Section[] {
	const { agents, query } = useAppStore.getState();
	const registered = queryClient.getQueryData(projectsQuery.queryKey) ?? NONE;
	const sessions =
		queryClient.getQueryData(sessionsQuery.queryKey) ?? NO_SESSIONS;
	const groups = queryClient.getQueryData(groupsQuery.queryKey) ?? NO_GROUPS;
	return buildSections(agents, query, registered, sessions, groups);
}

/** What the cursor is on right now. */
export function selectedRow(): Row | undefined {
	const { cursor, query } = useAppStore.getState();
	return flatten(visibleSections(), query)[cursor];
}

/**
 * The project the cursor is working in — the row itself, or the row's home.
 *
 * A session is always in a project, so standing on one is standing in that
 * project just as much as standing on its heading is. `⌃n` used to disagree:
 * it read the row, found a session, and did nothing, so opening a second
 * session meant arrowing back up to the folder first. The key is about where
 * you are, and a session says where you are.
 */
export function selectedProject(): Project | undefined {
	const row = selectedRow();
	if (row?.kind === "project") return row.project;
	// a group heading is inside exactly one project, and carries it
	if (row?.kind === "group") return row.project;
	if (row?.kind !== "session") return undefined;

	const registered = queryClient.getQueryData(projectsQuery.queryKey) ?? NONE;
	return registered.find((project) => project.id === row.session.projectId);
}

/**
 * The group the cursor is working in, when there is one.
 *
 * A session row counts as being in its group for the same reason it counts as
 * being in its project: where you are standing is where you are. Returns
 * undefined for a session in no bucket, which is not a failure — it is a
 * session in no bucket.
 */
export function selectedGroup(): Group | undefined {
	const row = selectedRow();
	if (row?.kind === "group") return row.group;
	if (row?.kind !== "session" || !row.session.groupId) return undefined;

	const groups = queryClient.getQueryData(groupsQuery.queryKey) ?? NO_GROUPS;
	return groups.find((group) => group.id === row.session.groupId);
}

/**
 * How many sessions a group holds, counted off what is on screen.
 *
 * The roster's own sections rather than the raw session list, so a search that
 * has narrowed the tree narrows this too — the number in the confirm panel then
 * matches the rows the person is looking at, which is the only number they can
 * check.
 */
export function sessionsIn(groupId: string): number {
	return (
		visibleSections()
			.flatMap((section) => section.buckets)
			.find((bucket) => bucket.group.id === groupId)?.sessions.length ?? 0
	);
}

/**
 * Derived reads live in hooks, not in selectors: a selector that returns a new
 * array on every call re-renders forever under zustand's reference check. Two
 * stable selectors plus a memo keeps the identity honest.
 */
export function useVisibleSections(): Section[] {
	const agents = useAppStore((state) => state.agents);
	const query = useAppStore((state) => state.query);
	const registered = useQuery(projectsQuery).data ?? NONE;
	const sessions = useQuery(sessionsQuery).data ?? NO_SESSIONS;
	const groups = useQuery(groupsQuery).data ?? NO_GROUPS;
	return useMemo(
		() => buildSections(agents, query, registered, sessions, groups),
		[agents, query, registered, sessions, groups],
	);
}

/** Flat, in paint order — this is what the cursor indexes into. */
export function useVisibleRows(): Row[] {
	const sections = useVisibleSections();
	const query = useAppStore((state) => state.query);
	return useMemo(() => flatten(sections, query), [sections, query]);
}

export function useSelectedRow(): Row | undefined {
	const rows = useVisibleRows();
	const cursor = useAppStore((state) => state.cursor);
	return rows[cursor];
}
