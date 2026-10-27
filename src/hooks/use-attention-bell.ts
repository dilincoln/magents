import { useRenderer } from "@opentui/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { flags } from "../lib/flags";
import { sessionsQuery } from "../queries/sessions-query";

/** BEL. What the terminal does with it — a sound, a flash, a taskbar — is its own. */
const BELL = "\u0007";

/**
 * Rings the terminal's bell when a session starts wanting somebody.
 *
 * The pulse on a row and the footer that stands in for it are both on screen,
 * which is no use to somebody in another window. The bell is what reaches
 * them, and it is the terminal's to render, so it follows whatever the person
 * already set up for every other program.
 *
 * Here and not inside the panes because the panes cannot do it: an agent's own
 * BEL goes into the emulator that draws its screen, which keeps it, and only
 * the session on screen has a pane at all. The flag is the one signal that
 * covers every session, attached or not — it is what the hooks set when an
 * agent finishes a turn or asks a question.
 *
 * A *transition* rings, from not lit to lit, and only on a session already seen
 * unlit. Two cases fall out of that on purpose. The list this process first
 * loads is the past, and ringing for it would be a bell every time magents
 * starts. And a session is born lit — see `openSession`, "nobody has looked at
 * this yet" — so ringing for arrivals would answer every `⌃n` with a bell for
 * the session just asked for.
 *
 * One ring per refetch however many lit at once: two bells a frame apart are
 * one sound, and the footer already says how many.
 *
 * Written through the renderer rather than to `process.stdout`, because the
 * renderer draws from a native thread that writes to the same descriptor. A BEL
 * that lands inside one of its escape sequences is harmless in a CSI and ends an
 * OSC early — a hyperlink or the OSC 52 copy — and the tail of it is printed as
 * text. The renderer's own queue is the one place nothing interleaves; it is
 * the path the clipboard takes too. It is private in the types and public in
 * practice, which is why it is reached through a cast.
 */
export function useAttentionBell(): void {
	const renderer = useRenderer();
	const sessions = useQuery(sessionsQuery).data;
	const lit = useRef<Map<string, boolean> | null>(null);

	useEffect(() => {
		if (!sessions) return;

		const before = lit.current;
		lit.current = new Map(
			sessions.map((session) => [session.id, session.requiresAttention]),
		);
		if (!before || !flags.bell) return;

		const rang = sessions.some(
			(session) =>
				session.requiresAttention && before.get(session.id) === false,
		);
		if (rang) {
			(renderer as unknown as { writeOut(data: string): boolean }).writeOut(
				BELL,
			);
		}
	}, [sessions, renderer]);
}
