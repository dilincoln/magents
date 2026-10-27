/**
 * Turning the flat agent list into what the roster shows: searched, then
 * grouped by project. Pure — the store calls it, the components read it.
 *
 * There is no provider filter any more. It was a second way to narrow the same
 * list, and the search already does it: typing `codex` matches the provider
 * like any other field, and unlike a filter it can be combined with a word.
 */

import type {
	Group,
	Project as RegisteredProject,
} from "../../daemon/db/schema";
import type { LiveSession as Session } from "../../daemon/services/terminals";
import { type Agent, scopeOf, USER_AGENTS_PATH } from "./agents";

/**
 * One of a project's buckets, with what is in it.
 *
 * `Group` here is the daemon's row — the thing somebody named. This file used
 * to call its project buckets `Group`, which is the name the feature needed, so
 * they became `Section`: a section of the roster, which is what they always
 * were.
 */
export interface Bucket {
	group: Group;
	sessions: Session[];
}

export interface Section {
	key: string;
	/** the repo folder — the full path lives in the header, next to the wordmark */
	label: string;
	agents: Agent[];
	/**
	 * The sessions in no group at all.
	 *
	 * Not a leftover state to be migrated away. A project with no groups is
	 * every project as this shipped, and `--no-group` is a thing somebody can
	 * ask for on purpose; both land here, and both draw exactly where a session
	 * drew before buckets existed.
	 */
	sessions: Session[];
	/** its buckets, in the order the daemon sent them — see `listGroups` */
	buckets: Bucket[];
	/**
	 * The project this section *is*, when the backend has one, and null when the
	 * section is seeded in the screen. Carrying the project rather than a
	 * boolean: everything that wanted to know it was registered also wanted the
	 * id or the path a moment later, and a flag beside the thing it describes is
	 * a second source for the same fact.
	 */
	project: RegisteredProject | null;
}

/**
 * A line the cursor can land on.
 *
 * Projects and agents are both selectable, so the flat list cannot be a list of
 * agents any more. A project row is the group's own heading: selecting it is how
 * anything gets said *about* the project, and removing one is the first thing
 * that needs to be.
 */
export type Row =
	| { kind: "project"; project: RegisteredProject }
	/**
	 * A bucket's heading. Carries its project as well as itself, because
	 * everything a key does to a group needs one — a new group goes *in* a
	 * project, and a rename has to know which project's names it must not
	 * collide with — and walking back up from the group to find it would mean
	 * every caller doing the same lookup.
	 */
	| { kind: "group"; group: Group; project: RegisteredProject }
	| { kind: "session"; session: Session }
	| { kind: "agent"; agent: Agent };

/** The user-level section, always last: agents that belong to no project. */
const USER_SECTION = {
	key: "user",
	label: "user",
	project: null,
	sessions: [],
	buckets: [],
};

/**
 * Everything the search can match on, joined once per agent. Cached in a
 * WeakMap because agents are immutable — a new object means a new haystack.
 */
const haystacks = new WeakMap<Agent, string>();

function haystack(agent: Agent): string {
	const cached = haystacks.get(agent);
	if (cached) return cached;

	const built = [
		agent.name,
		agent.description,
		agent.provider,
		agent.model,
		agent.tools.join(" "),
		scopeOf(agent),
		USER_AGENTS_PATH,
	]
		.join(" ")
		.toLowerCase();

	haystacks.set(agent, built);
	return built;
}

/** Terms are ANDed: "codex atlas" means both, in any field, in any order. */
function matchesText(text: string, query: string): boolean {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	return terms.every((term) => text.includes(term));
}

export function matchesQuery(agent: Agent, query: string): boolean {
	return matchesText(haystack(agent), query);
}

export function selectAgents(agents: Agent[], query: string): Agent[] {
	return agents.filter((agent) => matchesQuery(agent, query));
}

/**
 * Registered projects first — those are real, they came from the daemon — then
 * the user-level section.
 *
 * A registered project is kept even with nothing in it: an empty section is the
 * only way "you just added this" is visible, and dropping it would make adding
 * a project look like it did nothing. The user section is dropped when empty, so
 * a search collapses the roster down to what it hit.
 *
 * Buckets follow the same rule one level down, with one difference that only
 * shows up under a query. Idle, an empty group is kept — somebody made it a
 * moment ago and a heading that vanishes until it has something in it is a
 * heading you cannot put anything in. Searching, it is dropped: a query is a
 * request to see what matched, and a column of empty headings is the opposite
 * of narrowing.
 */
export function buildSections(
	agents: Agent[],
	query: string,
	registered: RegisteredProject[],
	sessions: Session[] = [],
	groups: Group[] = [],
): Section[] {
	const selected = selectAgents(agents, query);

	// A session's searchable text is its title, its provider and its model —
	// everything else about it is inside the CLI. Its project row is never
	// hidden by a search that missed the session, so a hit still has a home.
	const open = sessions.filter((session) =>
		matchesText(
			`${session.title} ${session.provider} ${session.model ?? ""}`.toLowerCase(),
			query,
		),
	);

	/*
	 * A project is shown when it matches, and also when something under it does.
	 *
	 * The second half is not a nicety. A session is only ever drawn beneath its
	 * project, so a section dropped for not matching takes its matching sessions
	 * with it — searching a session's own title would hide it. That was
	 * survivable while a provider filter existed beside the search; it is not
	 * now that the search is the only way to narrow anything.
	 */
	const real: Section[] = registered
		.map((project) => {
			const mine = open.filter((session) => session.projectId === project.id);

			const buckets = groups
				.filter((group) => group.projectId === project.id)
				.map((group) => ({
					group,
					sessions: mine.filter((session) => session.groupId === group.id),
				}))
				.filter((bucket) => !query || bucket.sessions.length > 0);

			return {
				key: project.id,
				label: project.name,
				// nothing to put here yet: agents are still seeded in the screen, not
				// stored, so a registered project is a project with no agents
				agents: [],
				// only the ones no bucket claimed. A session whose group was removed
				// under it lands here rather than nowhere, which is the whole reason
				// this is computed by exclusion instead of by `groupId === null`:
				// a stale `groupId` pointing at a group this client has not heard of
				// yet would otherwise make the row disappear.
				sessions: mine.filter(
					(session) =>
						!buckets.some((bucket) =>
							bucket.sessions.some((one) => one.id === session.id),
						),
				),
				buckets,
				project,
			};
		})
		.filter(
			(section) =>
				section.sessions.length > 0 ||
				section.buckets.length > 0 ||
				matchesText(
					`${section.project.name} ${section.project.path}`.toLowerCase(),
					query,
				),
		);

	const user: Section = { ...USER_SECTION, agents: selected };

	return [...real, ...(user.agents.length > 0 ? [user] : [])];
}

const plural = (count: number, noun: string, suffix = "s"): string =>
	`${count} ${noun}${count === 1 ? "" : suffix}`;

/**
 * The count under the tagline: "3 sessions · 2 projects" idle, "3 matches"
 * while searching.
 *
 * Projects are counted with sessions rather than beside them once a query is
 * on, because one search runs over both and a total that ignored half of it
 * would contradict the roster — "no matches" over two visible project rows.
 */
export function summarize(
	sessions: number,
	projects: number,
	query: string,
): string {
	if (!query) {
		const counted = plural(sessions, "session");
		return projects === 0
			? counted
			: `${counted} · ${plural(projects, "project")}`;
	}

	const matches = sessions + projects;
	if (matches === 0) return "no matches";
	return plural(matches, "match", "es");
}

/**
 * The flat list in the order the roster paints it. The cursor is an index into
 * this, so it has to come from the sections and not from `selectAgents`
 * directly.
 *
 * A registered section contributes its own heading first, then its buckets,
 * then whatever is in no bucket, then its agents. A seeded section contributes
 * only agents — there is nothing behind its heading to select.
 *
 * Buckets before loose sessions because a bucket is a decision somebody made
 * and a loose session is the absence of one. Reading down a project, the
 * organised part comes first and the remainder is the remainder.
 *
 * A folded bucket keeps its heading and loses its sessions, which is the whole
 * point of folding one. `group.collapsed` says so — it is a column now, not a
 * set held in this process, so the fold is the same fold in every window.
 *
 * A query overrules it: a search is a request to be shown what matched, and a
 * match hidden inside something closed an hour ago is a search that answers
 * wrongly. Overruled and not forgotten — clearing the query puts it back — and
 * overruled *here*, in the screen, because a question being asked in one window
 * is not a reason to unfold anything for anybody else.
 */
export function flatten(sections: Section[], query = ""): Row[] {
	return sections.flatMap((section): Row[] => [
		...(section.project
			? [{ kind: "project" as const, project: section.project }]
			: []),
		...section.buckets.flatMap((bucket): Row[] => {
			// narrowed once, so the two uses below cannot disagree about whether
			// this section has a project behind it
			const project = section.project;
			if (!project) return [];

			return [
				{ kind: "group" as const, group: bucket.group, project },
				...(!query && bucket.group.collapsed
					? []
					: bucket.sessions.map((session) => ({
							kind: "session" as const,
							session,
						}))),
			];
		}),
		// sessions before agents: one is running and the other is a description
		...section.sessions.map((session) => ({
			kind: "session" as const,
			session,
		})),
		...section.agents.map((agent) => ({ kind: "agent" as const, agent })),
	]);
}
