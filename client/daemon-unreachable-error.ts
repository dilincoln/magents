/**
 * The socket would not connect — the daemon is not running.
 *
 * Its own type because it is the one failure the user fixes somewhere else
 * entirely. Everything else the daemon says is an answer about the request; this
 * is the absence of a daemon, and the screen says so differently.
 */
export class DaemonUnreachable extends Error {
	constructor() {
		super("not connected — start the backend with `bun run daemon`");
		this.name = "DaemonUnreachable";
	}
}
