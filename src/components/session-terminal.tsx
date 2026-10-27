import type { BoxRenderable, EmbeddedTerminalRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { useEffect, useRef } from "react";
import {
	paneMounted,
	paneUnmounted,
	setWriter,
	terminalFor,
} from "../lib/session-terminals";
import { theme } from "../lib/theme";

/**
 * The window onto a session's terminal.
 *
 * A window, and no more than that. magents holds none of the conversation — the
 * CLI wrote it, the CLI stores it, and `resume` is how it comes back — and it
 * does not hold the process either. The process is not in this program at all:
 * the daemon spawned it and holds its master fd, so this pane is one of
 * possibly several views of it, and closing the window ends nothing.
 *
 * So this mounts by attaching an existing renderable to the box on screen and
 * unmounts by detaching it. What crosses that boundary either way is a size:
 * the daemon arbitrates the PTY over every attached client, so mounting casts a
 * vote and unmounting withdraws one, and `onTerminalResize` reports rather than
 * commands.
 */
export function SessionTerminal({
	sessionId,
	focused,
	onFocus,
}: {
	sessionId: string;
	/** whether keys are going here rather than to the roster */
	focused: boolean;
	onFocus: () => void;
}) {
	const renderer = useRenderer();
	const hostRef = useRef<BoxRenderable | null>(null);
	const termRef = useRef<EmbeddedTerminalRenderable | null>(null);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;

		const terminal = terminalFor(renderer, sessionId);
		termRef.current = terminal;
		host.add(terminal);
		paneMounted(sessionId);

		return () => {
			termRef.current = null;
			paneUnmounted(sessionId);

			/*
			 * `onData` comes off before the removal, and the order is the whole
			 * point: `onRemove()` blurs, and `blur()` encodes a focus-out and sends
			 * it through `onData` as input. A detached pane has no focus to report,
			 * so that byte was always wrong — it used to be a synchronous poke into
			 * a PTY this process owned, and it is now an async send racing the
			 * teardown into an agent nobody here speaks for any more.
			 *
			 * The registry puts it back on the way in, which is why unsetting it
			 * here does not leave a pane that cannot be typed at.
			 */
			terminal.onData = undefined;

			// Detached, not destroyed, and nothing is killed. The guard is for the
			// one case where it is already gone: removing the session lets go of
			// its terminal outright, and that runs before React notices the row it
			// was on has disappeared.
			if (terminal.parent === host) host.remove(terminal);
		};
	}, [renderer, sessionId]);

	useEffect(() => {
		const terminal = termRef.current;
		// detaching blurs on its own, so a background terminal never holds the
		// keyboard; this is only about the one on screen
		if (!terminal || terminal.isDestroyed) return;

		if (focused) {
			terminal.focus();
			// and nothing on the way back out. The write token is attachment-scoped
			// on the daemon's side, so giving it up on a trip to the roster would
			// leave the session with no owner and the daemon dropping the device
			// responses an agent is waiting on.
			setWriter(sessionId);
		} else terminal.blur();
	}, [focused, sessionId]);

	return (
		<box
			ref={hostRef}
			/*
			 * A click is someone reaching for the program inside, which is the same
			 * thing the key does — and it claims the write token as well as the
			 * focus, which the key cannot. Another window claiming the token out
			 * from under an already-focused pane changes nothing React can see, so
			 * the focus effect never runs again and there is no gesture left that
			 * asks for the keyboard back. The status strip is what says the keys
			 * are going nowhere; this is what answers it.
			 */
			onMouseDown={() => {
				onFocus();
				setWriter(sessionId);
			}}
			style={{
				width: "100%",
				height: "100%",
				flexGrow: 1,
				backgroundColor: theme.bg,
			}}
		/>
	);
}
