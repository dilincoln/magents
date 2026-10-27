import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { Project } from "../../daemon/db/schema";
import type { ProviderId } from "../../daemon/providers/provider-id";
import { useGroupChoice } from "../hooks/use-group-choice";
import { useModelSelection } from "../hooks/use-model-selection";
import { useProviderChoice } from "../hooks/use-provider-choice";
import { useRememberedSpawn } from "../hooks/use-remembered-spawn";
import { theme } from "../lib/theme";
import { rememberModel } from "../lib/tui-preferences";
import { wrapClamped } from "../lib/wrap-clamped";
import { useOpenSession } from "../queries/use-open-session";
import { useAppStore } from "../store/use-app-store";
import { ModelLine } from "./model-line";
import { SkillTextarea } from "./skill-textarea";
import { PressableText } from "./ui/pressable";

/**
 * Where the panel opens the *first* time, before there is anything to go on.
 *
 * After that it opens on whatever was last spawned — see `useRememberedSpawn`.
 * Both providers are reachable from here with `⌃p` either way.
 */
const OPENS_ON: ProviderId = "codex";

/** Two lines for whatever went wrong, the same as the model row allows. */
const ERROR_LINES = 2;

/**
 * What an agent is going to be asked to do, in the project it will run in, on
 * the model it will run on.
 *
 * Submitting opens a session and closes the panel. Starting it is the daemon's,
 * and by the time this answers it has already happened — the process is running
 * on the other side of the socket whether or not anybody ever looks at it. This
 * form's job ends at "it exists", and the pane's job is to go and watch.
 *
 * Plain `enter` belongs to the box. A prompt worth writing is often more than
 * one line, and a form that sends on the first newline cannot take one — so
 * sending is a chord, with a button beside it that means the same thing.
 *
 * The label says `⌃s`, always, and `⌃s` is a control byte that survives any
 * terminal. `⌃⏎` is still accepted below and is deliberately not advertised:
 * whether it is even a distinct key depends on the terminal disambiguating it
 * from a bare carriage return, and the label used to be picked from the kitty
 * capability the renderer reports. That reports the protocol having been
 * negotiated rather than `⌃⏎` actually arriving as its own key — so on a
 * terminal that claimed it, the button named a key that did nothing.
 *
 * A label is a promise, so it names the one that cannot fail. The other stays
 * in the handler for the terminals where it does work, where it costs nothing
 * and surprises nobody.
 */
export function SpawnSessionForm({
	project,
	width,
	close,
}: {
	project: Project;
	/** how much room the panel leaves — what descriptions are wrapped against */
	width: number;
	close: () => void;
}) {
	/*
	 * Where the three pickers start: what was last spawned in *this project*,
	 * kept in `~/.magents/tui.json`, and the last session anywhere when there
	 * is nothing for this one yet. Submitting writes it back, on success, so
	 * the next panel on this project opens where this one closed. See
	 * `useRememberedSpawn` and `tui-preferences.ts`.
	 */
	const remembered = useRememberedSpawn(project.path, OPENS_ON);
	const choice = useProviderChoice(remembered.provider);
	// Not remembered the way the model is, and deliberately: a group is the
	// project's answer to where work goes, so the project's default is the right
	// starting point every time rather than whatever was picked last.
	const bucket = useGroupChoice(project.id);
	const selection = useModelSelection(
		choice.provider,
		remembered.on(choice.provider),
	);
	const open = useOpenSession();

	/*
	 * A copy of what is in the box, kept because the box is uncontrolled and the
	 * two ways of sending are both out here. Not the source of the text — the
	 * textarea owns that — only what this form knows about it.
	 */
	const [prompt, setPrompt] = useState("");
	const hasModelLoaded = selection.model;
	const ready = prompt.trim().length > 0 && !open.isPending && hasModelLoaded;

	const submit = () => {
		// guarded rather than merely styled: the button is one way in and the
		// chord is another, and a second send while the first is minting would
		// open two sessions for one intention
		if (!ready) return;

		open.mutate(
			{
				projectId: project.id,
				provider: choice.provider,
				prompt,
				model: selection.model?.id ?? null,
				variant: selection.variant?.id ?? null,
				// Always explicit, never absent. The daemon reads a missing field as
				// "you decide" and falls back to the project's default — which this
				// panel has already resolved and shown on screen, so leaving it out
				// would make the *none* option impossible to express and the line
				// above the box a suggestion rather than a statement.
				groupId: bucket.group?.id ?? null,
			},
			{
				onSuccess: ({ session }) => {
					// The one thing this screen keeps for itself: what was just run
					// here, so the next panel on this project opens on it. On success
					// and not on submit, because a spawn the daemon refused is not a
					// choice anybody made.
					if (selection.model) {
						rememberModel(project.path, {
							provider: choice.provider,
							model: selection.model.id,
							variant: selection.variant?.id ?? null,
						});
					}

					// nothing is handed over any more: no argv comes back, because the
					// daemon runs the provider itself, and the process is already on
					// the row by the time this answers — so all that is left to say
					// here is where to point the cursor. The pane reads the rest off
					// the session frame.
					useAppStore.getState().opened(session.id);
					close();
				},
			},
		);
	};

	useKeyboard((key) => {
		if (!key.ctrl) return;

		// both, always — the label names only `⌃s`, and the handler takes either,
		// so a terminal where `⌃⏎` does arrive as its own key still sends
		const sends =
			key.name === "return" || key.name === "enter" || key.name === "s";
		if (!sends || !ready) return;

		submit();
		key.preventDefault();
		key.stopPropagation();
	});

	return (
		<>
			{/* Where it is going, said before what it will run on: the project and
			    the bucket are facts about where the work lands, and the model is a
			    fact about the work. `⌃g` only appears when there is somewhere else
			    to put it — a project with no groups has one answer, and a key that
			    cycles a ring of one is a key that lies about having a choice. */}
			<box
				style={{
					width: "100%",
					flexShrink: 0,
					flexDirection: "row",
					justifyContent: "space-between",
				}}
			>
				<text selectable={false} style={{ flexGrow: 1, flexShrink: 1 }}>
					<span style={{ fg: theme.muted }}>in </span>
					<b style={{ fg: theme.text }}>{project.name}</b>
					{bucket.group ? (
						<>
							<span style={{ fg: theme.muted }}>{" · "}</span>
							<span style={{ fg: theme.accent }}>{bucket.group.title}</span>
						</>
					) : (
						<span style={{ fg: theme.faint }}>{" · no group"}</span>
					)}
				</text>

				{bucket.options > 1 ? (
					<PressableText
						onPress={() => bucket.cycle()}
						style={{ flexShrink: 0, fg: theme.faint }}
					>
						⌃g group
					</PressableText>
				) : null}
			</box>

			<ModelLine choice={choice} selection={selection} width={width} />

			<SkillTextarea
				projectPath={project.path}
				provider={choice.provider}
				width={width}
				height={5}
				focused={!open.isPending}
				onChange={setPrompt}
			/>

			{open.error ? (
				<text
					selectable={false}
					// already broken by hand; left to itself it would break again
					style={{ flexShrink: 0, fg: theme.warn, wrapMode: "none" }}
				>
					{wrapClamped(open.error.message, width, ERROR_LINES).join("\n")}
				</text>
			) : null}

			<box
				style={{
					width: "100%",
					flexShrink: 0,
					marginTop: 1,
					flexDirection: "row",
					justifyContent: "flex-end",
				}}
			>
				<PressableText
					// withheld rather than refused, so that the button looks as dead as
					// it is: `submit` still guards itself for the chord's sake, but a
					// handler here would also buy a hover, and a thing that lights up
					// under the pointer and then does nothing is worse than a grey one
					onPress={ready ? submit : undefined}
					style={{ flexShrink: 0, fg: ready ? theme.accent : theme.faint }}
				>
					{open.isPending ? "opening a session…" : "⌃s spawn"}
				</PressableText>
			</box>
		</>
	);
}
