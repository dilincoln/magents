import type { Server } from "bun";
import { Effect } from "effect";
import type { Database } from "../services/database";
import type { AttachData, Terminals } from "../services/terminals";
import { deleteGroup } from "./delete-group";
import { deleteProject } from "./delete-project";
import { deleteSession } from "./delete-session";
import { deleteSessionTerminal } from "./delete-session-terminal";
import { getGroups } from "./get-groups";
import { getHealth } from "./get-health";
import { getModels } from "./get-models";
import { getProjects } from "./get-projects";
import { getSessionAttach } from "./get-session-attach";
import { getSessions } from "./get-sessions";
import { patchGroup } from "./patch-group";
import { patchSession } from "./patch-session";
import { postGroups } from "./post-groups";
import { postProjects } from "./post-projects";
import { postSessionImport } from "./post-session-import";
import { postSessionTerminal } from "./post-session-terminal";
import { postSessions } from "./post-sessions";

/**
 * The routing table. Small enough to read at a glance, and it stays that way as
 * long as each route is its own file with its own error mapping.
 *
 * `undefined` is now an answer: a request that became a WebSocket has already
 * been replied to with a 101 nobody here composed, and returning a `Response`
 * after that would be a second reply to a connection that is no longer an HTTP
 * one. `server` is passed for that route alone — the upgrade needs the listener
 * — and it can be handed down through an ordinary Effect because the upgrade
 * does *not* have to be synchronous: a handler that awaits and then upgrades
 * was measured returning true and the client connecting.
 */
export const handleRequest = (
	request: Request,
	server: Server<AttachData>,
): Effect.Effect<Response | undefined, never, Database | Terminals> => {
	const { pathname, searchParams } = new URL(request.url);

	if (pathname === "/health") {
		if (request.method === "GET") return getHealth;
		return methodNotAllowed;
	}

	if (pathname === "/sessions") {
		if (request.method === "GET")
			return getSessions(searchParams.get("project"));
		if (request.method === "POST") return postSessions(request);
		return methodNotAllowed;
	}

	if (pathname === "/groups") {
		if (request.method === "GET") return getGroups(searchParams.get("project"));
		if (request.method === "POST") return postGroups(request);
		return methodNotAllowed;
	}

	if (pathname === "/projects") {
		if (request.method === "GET") return getProjects;
		if (request.method === "POST") return postProjects(request);
		return methodNotAllowed;
	}

	// Above the catch-all below, like `/attach` and `/terminal` — it would
	// otherwise be read as a session whose id is the word `import`, and refused
	// as a method that is not DELETE.
	if (pathname === "/sessions/import") {
		if (request.method === "POST") return postSessionImport(request);
		return methodNotAllowed;
	}

	// Above the `/sessions/` catch-all below, and that is not a matter of taste:
	// the catch-all takes everything after the prefix, so it would read this as a
	// session whose id is `<id>/attach` and refuse it as a method that is not
	// DELETE.
	const attaching = pathname.match(/^\/sessions\/([^/]+)\/attach$/)?.[1];

	if (attaching) {
		if (request.method === "GET") {
			return getSessionAttach(request, server, attaching);
		}
		return methodNotAllowed;
	}

	const terminal = pathname.match(/^\/sessions\/([^/]+)\/terminal$/)?.[1];

	if (terminal) {
		if (request.method === "POST") return postSessionTerminal(terminal);
		if (request.method === "DELETE") return deleteSessionTerminal(terminal);
		return methodNotAllowed;
	}

	const sessionId = pathname.startsWith("/sessions/")
		? pathname.slice("/sessions/".length)
		: null;

	if (sessionId) {
		if (request.method === "DELETE") return deleteSession(sessionId);
		if (request.method === "PATCH") return patchSession(sessionId, request);
		return methodNotAllowed;
	}

	const groupId = pathname.startsWith("/groups/")
		? pathname.slice("/groups/".length)
		: null;

	if (groupId) {
		if (request.method === "PATCH") return patchGroup(groupId, request);
		if (request.method === "DELETE") return deleteGroup(groupId);
		return methodNotAllowed;
	}

	const provider = pathname.match(/^\/providers\/([^/]+)\/models$/)?.[1];

	if (provider) {
		if (request.method === "GET") return getModels(provider);
		return methodNotAllowed;
	}

	const id = pathname.startsWith("/projects/")
		? pathname.slice("/projects/".length)
		: null;

	if (id) {
		if (request.method === "DELETE") return deleteProject(id);
		return methodNotAllowed;
	}

	return Effect.succeed(
		Response.json({ error: `no route for ${pathname}` }, { status: 404 }),
	);
};

// built per request, not once: a shared `Response` has one body, and the second
// caller to be refused would get an empty one
const methodNotAllowed = Effect.sync(() =>
	Response.json({ error: "method not allowed" }, { status: 405 }),
);
