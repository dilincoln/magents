import { listGroups } from "../../client/list-groups";
import type { Group } from "../../daemon/db/schema";
import { short } from "./columns";
import { find } from "./find";

/**
 * The group a command is about, inside a project.
 *
 * Scoped to the project rather than searched globally, and that is the whole
 * reason this is not `resolveSession` with a different table. Group names are
 * only unique within a project — `Active` in two repositories is two different
 * buckets and the database allows exactly that — so a global lookup would
 * refuse `Active` as ambiguous the moment somebody used the obvious name twice.
 * The project is always known by the time a group is being named.
 */
export async function resolveGroup(
	ref: string,
	projectId: string,
	projectName: string,
): Promise<Group> {
	const groups = await listGroups(projectId);

	const hit = find(
		groups,
		ref,
		(group) => ({
			id: group.id,
			name: group.title,
			line: `${short(group.id)}  ${group.title}`,
		}),
		"group",
	);

	if (!hit) {
		throw new Error(
			groups.length === 0
				? `${projectName} has no groups yet — make one with \`magents groups add\``
				: `no group named ${ref} in ${projectName} — it has ${groups
						.map((group) => group.title)
						.join(", ")}`,
		);
	}

	return hit;
}
