import { socketPath } from "../daemon/paths/socket-path";
import { DaemonUnreachable } from "./daemon-unreachable-error";

/**
 * One call to the daemon.
 *
 * The host in the URL is a formality — the connection goes to the unix socket,
 * so `daemon` is just a name to satisfy `fetch`.
 *
 * Two kinds of failure, told apart on purpose: a socket that will not connect
 * means the daemon is not running, which is a thing the user fixes in another
 * terminal; anything else is an answer the daemon gave, and it comes with a
 * sentence worth putting on the screen instead of a status code.
 */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
	let response: Response;

	try {
		response = await fetch(`http://daemon${path}`, {
			...init,
			unix: socketPath,
		});
	} catch {
		throw new DaemonUnreachable();
	}

	const body = (await response.json()) as T & { error?: string };

	if (!response.ok) {
		throw new Error(body?.error ?? `daemon answered ${response.status}`);
	}

	return body;
}
