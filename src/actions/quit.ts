import type { CliRenderer } from "@opentui/core";
import { detachAllTerminals } from "../lib/session-terminals";

/** Puts the terminal back the way it was found, then leaves. */
export function quit(renderer: CliRenderer): never {
	// The sockets first, and only the sockets. The agents are not ours to hang
	// up on any more — they are the daemon's children on master fds the daemon
	// holds, and this process leaving is a window closing rather than a machine
	// being switched off. Quitting is leaving the room; the light stays on.
	detachAllTerminals();
	renderer.destroy();
	process.exit(0);
}
