import { listSessions } from "../../client/list-sessions";
import type { LiveSession } from "../../daemon/services/terminals";
import { short } from "./columns";
import { find } from "./find";

/**
 * The session a command is about, from an id, the front of one, or its name.
 *
 * By name as well as by id because the name is the half a person can see: the
 * roster shows titles, `magents sessions` prints titles, and requiring the UUID
 * back would make the printed list something to read rather than something to
 * use. Two sessions with one name is a real possibility and it is refused
 * rather than guessed at — see `find`.
 */
export async function resolveSession(ref: string): Promise<LiveSession> {
	const sessions = await listSessions();

	const hit = find(
		sessions,
		ref,
		(session) => ({
			id: session.id,
			name: session.title,
			line: `${short(session.id)}  ${session.title}`,
		}),
		"session",
	);

	if (!hit) throw new Error(`no session matching ${ref}`);
	return hit;
}
