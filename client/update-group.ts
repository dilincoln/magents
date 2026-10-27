import type { Group } from "../daemon/db/schema";
import { request } from "./request";

/**
 * Renames a group, makes it the project's default, moves it in the list, or
 * any combination.
 *
 * There is no way to say `default: false`, and the daemon refuses it rather
 * than ignoring it: a project either has a home for new sessions or it has not,
 * and the way to move it is to name the group that should have it instead.
 */
export const updateGroup = (input: {
	id: string;
	title?: string;
	default?: true;
	/** takes either value, unlike `default` — see below */
	hibernates?: boolean;
	/**
	 * Whether its sessions are folded away in the roster.
	 *
	 * The state it should end in, not a toggle: two panes that both saw a group
	 * open and both said "toggle" would leave it open, which is neither of the
	 * two things they asked for.
	 */
	collapsed?: boolean;
	/**
	 * Where it goes: immediately after this group, or first when null.
	 *
	 * Present-or-absent, so `null` has to be spelled out to mean the front —
	 * leaving the field off is "leave it where it is". A neighbour rather than
	 * an index because the list may have moved since it was read, and a row is
	 * still the row it was.
	 */
	after?: string | null;
}): Promise<Group> =>
	request(`/groups/${input.id}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			...(input.title === undefined ? {} : { title: input.title }),
			...(input.default ? { default: true } : {}),
			...(input.hibernates === undefined
				? {}
				: { hibernates: input.hibernates }),
			...(input.collapsed === undefined ? {} : { collapsed: input.collapsed }),
			...("after" in input ? { after: input.after ?? null } : {}),
		}),
	});
