import type { BoxRenderable } from "@opentui/core";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { useFrame } from "../hooks/use-frame";
import { pulse } from "../lib/attention-pulse";
import {
	hibernatable,
	startable,
	useAttachStatus,
} from "../lib/session-terminals";
import { theme } from "../lib/theme";
import { sessionsQuery } from "../queries/sessions-query";
import { useKeyboardOwner } from "../store/keyboard-owner";
import { useSelectedRow } from "../store/use-app-store";
import { useCopyFlash } from "../store/use-copy-flash";
import { useSidebarStore } from "../store/use-sidebar-store";

/**
 * The shortcut bar. It follows the keyboard: only the live keys are listed.
 *
 * `⇧↑↓` is written as one hint for two keys, unlike `⌃r` and `⌃h`, because it
 * is one adjustment with two directions — and it is offered only on a group,
 * which is the only row with siblings to be moved among.
 *
 * `⌃n` and `⌃d` appear for a project and for a session alike — one spawns in
 * the project you are standing in and the other removes whichever row you are
 * on — and `⏎` only for a session. That is the only time any of them does
 * anything. A hint that is offered and then ignored is worse than no hint.
 *
 * A focused terminal gets a bar of its own, and it is one key long for as long
 * as there is a program inside to hand the rest to. `⌃r` joins it exactly when
 * there is not — the same rule the roster half of this bar follows, and the
 * same sentence the pane's own status line is showing at that moment.
 *
 * `⌃r` and `⌃h` are never offered together, and that is not an arrangement of
 * this bar: they read the session's state and no state is both. Between them
 * they leave a gap on purpose — a session still connecting offers neither,
 * because nothing here knows yet which one would be the truth.
 *
 * `⌃h` stays out of the attached bar even though the key still works there,
 * which is the one asymmetry. Attached, the sentence has a job — it explains why
 * the keyboard is not reaching an agent — and a running agent needs no
 * explanation; the whole point of that bar is to be one key long while there is
 * something to type at. `⌃e` is the exception that proves it: it is the one
 * other key the screen takes back from the agent, so the bar has to own up to
 * it or the claim after the dash is false.
 *
 * With the sidebar hidden the bar also carries the roster's other job — saying
 * that a session wants somebody. See `useWaiting`.
 */
export function Footer() {
	const owner = useKeyboardOwner();
	const row = useSelectedRow();
	const copied = useCopyFlash((state) => state.shown);
	const onProject = row?.kind === "project";
	const onSession = row?.kind === "session";
	const onGroup = row?.kind === "group";

	// ⌃r and ⌃h on the same terms as the rest of this bar: only where they do
	// something, which for one is a session with nothing running on it and for
	// the other is a session with something.
	const status = useAttachStatus((state) =>
		row?.kind === "session" ? state.status[row.session.id] : undefined,
	);
	const stopped = startable(status);
	const awake = hibernatable(status);
	const waiting = useWaiting();

	/*
	 * The same breathing wash a lit roster row has, over the whole bar, and on
	 * the same terms: through a ref, because a colour that moves every frame
	 * cannot be a prop. The `key` on the box is what puts it out — a box that
	 * stopped being written to would keep whichever shade it was left on, and
	 * remounting it lets the style say `theme.bg` again.
	 */
	const box = useRef<BoxRenderable>(null);
	const age = useRef(0);

	useFrame((dt) => {
		age.current += dt;
		if (box.current) box.current.backgroundColor = pulse(age.current);
	}, waiting > 0);

	const roster = [
		"/ search",
		"↑↓ navigate",
		"⌃a project",
		"⌃i import",
		// `⌃g` wherever it does something, which is anywhere inside a project —
		// its heading, one of its groups, or one of its sessions. It is the only
		// key here that is not about the row itself, so it sits with the other
		// two that are not either.
		...(onProject || onSession || onGroup ? ["⌃g group"] : []),
		...(onProject ? ["⌃n spawn", "⌃d remove"] : []),
		...(onGroup
			? ["⏎ fold", "⇧↑↓ reorder", "⌃n spawn", "⌃t edit", "⌃d remove"]
			: []),
		...(onSession
			? [
					"⏎ type",
					"⌃n spawn",
					...(stopped ? ["⌃r start"] : []),
					...(awake ? ["⌃h hibernate"] : []),
					"⌃t rename",
					"⌃b move",
					"⌃d remove",
				]
			: []),
		"⌃⌥←→ width",
		"⌃e sidebar",
		"q quit",
	].join("    ");

	return (
		<box
			key={waiting > 0 ? "waiting" : "calm"}
			ref={box}
			style={{
				width: "100%",
				height: 1,
				flexShrink: 0,
				backgroundColor: theme.bg,
			}}
		>
			<text
				selectable={false}
				style={{ width: "100%", height: 1, paddingLeft: 2, fg: theme.faint }}
			>
				{/* first, because it is the one thing on this line that is news, and
				    a line too narrow for the hints cuts them from the right */}
				{waiting > 0 ? (
					<b style={{ fg: theme.attention }}>
						{`● ${waiting === 1 ? "a session is" : `${waiting} sessions are`} waiting for you — ⌃e to show them    `}
					</b>
				) : (
					""
				)}
				{/* selection just landed on the clipboard, said where the eye goes
				    after a mouse gesture ends — and gone again before it nags */}
				{copied ? <span style={{ fg: theme.ok }}>{"✓ copied    "}</span> : ""}
				{owner === "suggestions"
					? "↑↓ pick    enter insert    esc dismiss"
					: owner === "search"
						? "esc leave    enter keep    ↑↓ navigate    ⌃a project"
						: owner === "modal"
							? "esc close    click away"
							: owner === "terminal"
								? stopped
									? "⌃⌥← detach    ⌃e sidebar    ⌃r start — there is nothing running to type at"
									: "⌃⌥← detach    ⌃e sidebar — every other key goes to the agent"
								: roster}
			</text>
		</box>
	);
}

/**
 * How many sessions are asking for somebody that nobody can currently see
 * asking — zero whenever the sidebar is up, because then the roster's own
 * pulse is already saying it, row by row, and saying it twice is noise.
 *
 * The selected session does not count. It is the one in the pane, and the
 * cursor resting on it is what puts its light out — see `useSeenSession` —
 * so counting it would flash the bar for the third of a second it takes
 * the agent you are already looking at to be marked read.
 */
function useWaiting(): number {
	const hidden = useSidebarStore((state) => !state.visible);
	const sessions = useQuery(sessionsQuery).data;
	const row = useSelectedRow();
	const selected = row?.kind === "session" ? row.session.id : null;

	if (!hidden || !sessions) return 0;
	return sessions.filter(
		(session) => session.requiresAttention && session.id !== selected,
	).length;
}
