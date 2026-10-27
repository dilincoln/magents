import type { ModelSelection } from "../hooks/use-model-selection";
import type { ProviderChoice } from "../hooks/use-provider-choice";
import { theme } from "../lib/theme";
import { wrapClamped } from "../lib/wrap-clamped";
import { PressableText } from "./ui/pressable";
import { ProviderMark } from "./ui/provider-mark";

/** Enough for the sentence and the instruction after it, and no more. */
const ERROR_LINES = 2;
/** The smallest gap that still reads as two things rather than one. */
const GAP = 2;
/** The mark and the space after it, which are not part of any label. */
const MARK = 2;

/**
 * What the agent will run on, and how to change it.
 *
 * One row, because it is one decision seen from three angles — the provider,
 * the model and how hard it thinks are not separate settings to a person, they
 * are "which of these". The keys sit on the same row as the thing they change
 * rather than in a hint at the bottom of the panel, which is three lines away
 * from the words it is talking about.
 *
 * The failure is on this row too. A provider whose CLI is not installed is the
 * most likely thing to go wrong here and the only one the user can fix, so it
 * gets the space the model would have had instead of being swallowed into an
 * empty list — an empty picker looks like a provider with nothing to offer.
 *
 * And it gets two lines when it needs them. These messages end in the sentence
 * that says what to do — "Reinstall Codex: npm install -g …" — so a single row
 * clips off exactly the half worth reading. There are no keys to make room for
 * when there is nothing to cycle, so the width is free.
 */
export function ModelLine({
	choice,
	selection,
	width,
}: {
	choice: ProviderChoice;
	selection: ModelSelection;
	/** the room the panel leaves, for wrapping a message that needs it */
	width: number;
}) {
	const { provider, providers } = choice;
	const { model, variant, models, variants, pending, error } = selection;

	/*
	 * The labels are the buttons. Only what there is something to cycle through
	 * appears, and what appears is clickable — a label naming a key is the
	 * obvious thing to reach for with a pointer, and a keyboard hint that ignores
	 * the mouse is a dead spot exactly where someone aimed.
	 *
	 * Built as a list rather than three conditionals so that what is drawn and
	 * what is measured come from one place. They have to agree: the width of
	 * this side is what the other side is allowed to be, and two copies of the
	 * rule would disagree the first time one of them changed.
	 */
	const controls = [
		providers > 1 ? { label: "⌃p provider", run: choice.cycle } : null,
		models > 1 ? { label: "⌃o model", run: selection.cycleModel } : null,
		variants > 1 ? { label: "⌃e variant", run: selection.cycleVariant } : null,
	].filter((control) => control !== null);

	const taken = controls.reduce(
		(total, control, at) => total + control.label.length + (at > 0 ? GAP : 0),
		0,
	);

	/*
	 * What the model name may occupy, once everything with a fixed size has been
	 * taken out. Claude's longest label and a variant come to exactly the inner
	 * width of the panel, so without this the two halves meet with no space
	 * between them and read as one run-on string — which is what they did.
	 *
	 * The variant keeps its full length and the name gives way, because the name
	 * is the part that survives being shortened: "Default (recommend…" is still
	 * that model, while a clipped `· medi` is a setting nobody can identify.
	 */
	const free = width - MARK - taken - GAP;
	const room = free - (variant ? variant.label.length + 3 : 0);

	return (
		<box
			style={{
				width: "100%",
				flexShrink: 0,
				flexDirection: "row",
				justifyContent: "space-between",
				marginBottom: 1,
			}}
		>
			<text
				selectable={false}
				// the error below is wrapped by hand and handed over with its breaks
				// already in it; left to wrap itself this would re-break those lines
				// against a width it shares with the controls, and the second line
				// would come out as one word
				style={{ wrapMode: "none" }}
			>
				<ProviderMark provider={provider} />
				{error ? (
					<span style={{ fg: theme.warn }}>
						{` ${wrapClamped(error.message, free, ERROR_LINES).join("\n  ")}`}
					</span>
				) : pending ? (
					<span style={{ fg: theme.faint }}>{` asking ${provider}…`}</span>
				) : model ? (
					<>
						<span style={{ fg: theme.text }}>
							{` ${clamp(model.label, room)}`}
						</span>
						{variant ? (
							<span style={{ fg: theme.muted }}>{` · ${variant.label}`}</span>
						) : null}
					</>
				) : (
					<span style={{ fg: theme.muted }}>
						{` ${provider} offers no models`}
					</span>
				)}
			</text>

			{/* `onMouseDown`, like every other click in the app: the panel stops the
			    event above this, so pressing one cannot also dismiss the dialog. */}
			<box style={{ flexShrink: 0, flexDirection: "row" }}>
				{controls.map((control, at) => (
					<PressableText
						key={control.label}
						onPress={() => control.run()}
						style={{
							fg: theme.faint,
							marginLeft: at > 0 ? GAP : 0,
						}}
					>
						{control.label}
					</PressableText>
				))}
			</box>
		</box>
	);
}

/**
 * One line, cut at the character with the cut marked.
 *
 * Not `wrapClamped`: that breaks on word boundaries, which is right for a
 * paragraph and wasteful for a label — asked for one line of 19 columns it
 * answers "Default…" rather than "Default (recommen…", throwing away eleven
 * columns to avoid splitting a word nobody minds splitting.
 */
const clamp = (text: string, room: number): string => {
	if (room < 1) return text;
	return text.length <= room ? text : `${text.slice(0, room - 1)}…`;
};
