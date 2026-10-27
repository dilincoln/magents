import {
	useKeyboard,
	useRenderer,
	useTerminalDimensions,
} from "@opentui/react";
import { quit } from "../actions/quit";
import { toggleSidebar } from "../actions/toggle-sidebar";
import { DetailPane } from "../components/detail-pane";
import { Footer } from "../components/footer";
import { Header } from "../components/header";
import { ModalHost } from "../components/modal-host";
import { Sidebar } from "../components/sidebar";
import { bindings } from "../constants/bindings";
import { useAttentionBell } from "../hooks/use-attention-bell";
import { useCopyOnSelect } from "../hooks/use-copy-on-select";
import { useDaemonHeartbeat } from "../hooks/use-daemon-heartbeat";
import { useFollowLaunch } from "../hooks/use-follow-launch";
import { useSeenSession } from "../hooks/use-seen-session";
import { startTerminal } from "../lib/session-terminals";
import { theme } from "../lib/theme";
import { keyboardOwner } from "../store/keyboard-owner";
import { selectedRow, useAppStore } from "../store/use-app-store";
import { useModalStore } from "../store/use-modal-store";
import { useSidebarStore } from "../store/use-sidebar-store";

export function AgentsScreen() {
	const renderer = useRenderer();
	const { width } = useTerminalDimensions();
	const sidebar = useSidebarStore((state) => state.visible);

	useDaemonHeartbeat();
	useFollowLaunch();
	useSeenSession();
	useCopyOnSelect();
	useAttentionBell();

	useKeyboard((key) => {
		const state = useAppStore.getState();
		const owner = keyboardOwner();

		/*
		 * A focused terminal is not a pane of ours with a few shortcuts over it —
		 * it is another program's keyboard, and every key belongs to it. `q` is a
		 * letter being typed, `esc` cancels something inside, and `⌃c` interrupts
		 * the agent rather than quitting magents, which is the one that would
		 * have hurt.
		 *
		 * `⌃⌥←` is the key kept back, and it is kept back here rather than left
		 * to the bindings table below for the same reason: reaching that table
		 * at all would hand the terminal's chords to the roster — where the same
		 * chord narrows the sidebar, which is the other thing it can mean and
		 * the one that applies when nothing is attached.
		 *
		 * Two modifiers, and each one was learned the hard way. The bare `←` was
		 * the key for a day and it is the agent's own cursor; `⌃←` was the key
		 * after that and it is the agent's word jump, which claude and codex both
		 * honour and which turned out to be reached for constantly — taking it
		 * made moving back a word a matter of `⌥b`. Nothing inside either agent
		 * answers `⌃⌥←`, so holding both costs the agent nothing. `→` and `⏎`
		 * still attach, so the pair still reads like claude's own agent view —
		 * back with the left arrow, in with the right.
		 *
		 * `⌃o` still works and is not advertised. It was the key for a while and
		 * a chord that always reaches here is worth keeping for the hand that
		 * learned it.
		 */
		if (owner === "terminal") {
			// `meta` is how the parser reports alt, and it is the whole difference
			// between this and the word jump: a bare `⌃←` arrives without it
			if (key.ctrl && (key.name === "o" || (key.name === "left" && key.meta))) {
				state.focusRoster();
				key.preventDefault();
				key.stopPropagation();
			}

			/*
			 * ⌃r is kept back on the same terms and only on them. A session whose
			 * process has ended has no program inside to hand a key to, and that is
			 * the one moment the pane is offering this key on its own status line —
			 * a hint that only worked from the roster would be a hint that does not
			 * work. `startTerminal` answers whether there was anything to start, so
			 * a running agent keeps the chord like every other one.
			 */
			/*
			 * ⌃e too, unconditionally, and that is a cost paid on purpose: inside
			 * the agent it is end-of-line, the readline binding claude and codex
			 * both honour. `End` still does that. Giving the agent the whole
			 * screen is a thing somebody wants *while* attached — that is when the
			 * room is being used — and a toggle that had to detach first would be
			 * `⌃⌥←`, `⌃e`, `→` for one idea.
			 */
			if (key.ctrl && key.name === "e") {
				toggleSidebar();
				key.preventDefault();
				key.stopPropagation();
			}

			if (key.ctrl && key.name === "r") {
				const row = selectedRow();
				if (row?.kind === "session" && startTerminal(row.session.id)) {
					key.preventDefault();
					key.stopPropagation();
				}
			}
			return;
		}

		if (key.ctrl && key.name === "c") quit(renderer);

		/*
		 * Chords are answered before the owner is asked. That is the whole point
		 * of holding control: the key is safe to press while typing, so it works
		 * from the search as well as from the roster. A modal is the exception —
		 * it is a question on the screen, and spawning another one over it is not
		 * an answer to it.
		 *
		 * Whether a modal is *up*, not whether it holds the keyboard, and the
		 * difference was a bug. A suggestion picker outranks the modal it is
		 * sitting in — deliberately, so `esc` dismisses the list rather than the
		 * form — so `owner` reads `suggestions` while a form is on the screen, and
		 * asking the owner let every chord straight through. `⌃g` typed into the
		 * spawn box with the skill list open cycled the group *and* opened the
		 * new-group form over the top of it, which closed the box it was typed in.
		 */
		if (key.ctrl && useModalStore.getState().modal === null) {
			// alt has to agree as well as the letter, so `⌃⌥←` is the width
			// and a bare `⌃←` is nothing here, rather than whichever row came first
			const chord = bindings.find(
				(binding) =>
					binding.ctrl &&
					Boolean(binding.alt) === key.meta &&
					binding.keys.includes(key.name),
			);
			if (chord) {
				chord.run(renderer);
				return;
			}
		}

		// One owner at a time, so this reads as a switch rather than a pile of
		// guards. Whoever holds the keyboard gets first refusal on every key.
		switch (owner) {
			case "suggestions":
				// the picker answers for every key it holds, escape included. This
				// branch exists so that escape does not also close the modal the
				// picker is inside, on the keystroke meant to dismiss the list.
				return;

			case "modal": {
				// esc is the primitive's own contract; anything else a modal wants is
				// the content's business, which is why it is handed `close`. A locked
				// modal is the one exception, and it is the same exception the click
				// layers make: there is work in flight that closing would not stop.
				const modals = useModalStore.getState();
				if (key.name === "escape" && !modals.locked) modals.closeModal();
				return;
			}

			case "search":
				// every printable key belongs to the input; the shortcuts below
				// would otherwise eat the letters being typed
				if (key.name === "escape") state.focusRoster();
				if (key.name === "return" || key.name === "enter") state.focusRoster();
				if (key.name === "up") state.moveCursor(-1);
				if (key.name === "down") state.moveCursor(1);
				return;

			case "roster":
				break;
		}

		// With the roster holding the keyboard there is nothing left to special
		// case: the table says what each key does, and the key list is printed
		// from the same rows.
		//
		// A chord is reachable here only through its `fallback`, and the rows that
		// have one are the ones whose chord is an ASCII control character a
		// terminal already had a name for: `⌃i` is tab and `⌃h` is backspace, byte
		// for byte, so without kitty disambiguation they arrive as bare keys and
		// this is the only place they can still be recognised. Matching a chord's
		// own letter here would be a different thing entirely — it would make bare
		// `a` add a project — which is why the two lists stay separate.
		// Shift gets its own pass, ahead of the general one. A shifted arrow is
		// named `up` or `down` like a bare one — the modifier is a flag beside the
		// name, not part of it — so the lookup below would find the navigation row
		// first and scroll the roster instead of moving the group.
		if (key.shift) {
			const shifted = bindings.find(
				(binding) => binding.shift && binding.keys.includes(key.name),
			);
			if (shifted) {
				shifted.run(renderer);
				return;
			}
		}

		bindings
			.find((binding) =>
				binding.ctrl
					? binding.fallback?.includes(key.name)
					: // and a shift row is never reached from here: its keys are the
						// bare arrows, which would make plain ↑ move a group
						!binding.shift && binding.keys.includes(key.name),
			)
			?.run(renderer);
	});

	return (
		<box
			style={{
				width: "100%",
				height: "100%",
				flexDirection: "column",
				backgroundColor: theme.bg,
			}}
		>
			<Header />

			{/*
			 * The box that owns the split, and therefore the one that follows a
			 * drag on it. Not the seam itself: a one-column handle is a target the
			 * pointer leaves on the first movement, and the renderer hands the rest
			 * of the drag to whatever is under it — but every one of those events
			 * bubbles up through here on the way, whoever they were aimed at.
			 *
			 * `resizing` is the whole gate. Without it this would resize the
			 * sidebar every time somebody dragged across a terminal to select
			 * something in it.
			 */}
			<box
				onMouseDrag={(event) => {
					const sidebar = useSidebarStore.getState();
					if (!sidebar.resizing) return;
					// the seam is the sidebar's last column, so the pointer's column
					// *is* the width it is asking for
					sidebar.setWidth(event.x + 1, width);
				}}
				onMouseDragEnd={() => useSidebarStore.getState().endResize()}
				// a press that never became a drag still has to put the flag back
				onMouseUp={() => useSidebarStore.getState().endResize()}
				style={{ width: "100%", flexGrow: 1, flexDirection: "row" }}
			>
				{/*
				 * Unmounted rather than shrunk when hidden, so the detail pane's
				 * growth is the whole of the change and the agent's terminal is
				 * resized by the same layout callback a drag of the seam uses. The
				 * roster scrolls back to the cursor on its way back in — its follow
				 * effect runs on mount.
				 */}
				{sidebar ? <Sidebar /> : null}

				<DetailPane />
			</box>

			<Footer />

			<ModalHost />
		</box>
	);
}
