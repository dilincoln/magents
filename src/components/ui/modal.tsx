import type { ReactNode } from "react";
import { modalMetrics } from "../../lib/modal-metrics";
import { theme } from "../../lib/theme";
import { PressableText } from "./pressable";

/** How much of the screen survives behind the panel. */
const SCRIM_OPACITY = 0.45;

/**
 * A centred panel over a dimmed screen, with its own way out.
 *
 * Presentational, like everything in `ui/`: it does not know when it is open.
 * The screen decides that, because the screen is what owns the keyboard.
 *
 * Two absolute layers, and they are **siblings on purpose**. `opacity` in
 * OpenTUI multiplies down the tree, so a panel declared *inside* the scrim
 * inherits its opacity and the roster shows straight through the dialog — which
 * is what happened the first time, and why the dimming was taken out rather
 * than fixed. Side by side, the scrim dims what is behind it and the panel is
 * painted at full strength above it.
 *
 * Both layers close on click: the scrim is what the eye sees, but the layer
 * that actually catches a click outside the panel is the centring one on top of
 * it, and a click has to close from either.
 */
export function Modal({
	title,
	dismiss = "esc close",
	hint,
	width = 52,
	backdrop = theme.bg,
	onClose,
	children,
}: {
	title: string;
	/** what the way out is called, at the right of the title row */
	dismiss?: string;
	/** the keys that work in here, shown along the bottom edge */
	hint?: string;
	width?: number;
	/** what the screen is dimmed towards */
	backdrop?: string;
	onClose?: () => void;
	children?: ReactNode;
}) {
	// The dismiss control paints over the title's tail rather than pushing it,
	// so the collision is settled here instead of showing up as a mangled word.
	const room = width - dismiss.length - 8;
	const heading =
		title.length > room ? `${title.slice(0, Math.max(1, room - 1))}…` : title;

	return (
		<>
			<box
				onMouseDown={() => onClose?.()}
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					right: 0,
					bottom: 0,
					zIndex: 100,
					opacity: SCRIM_OPACITY,
					backgroundColor: backdrop,
				}}
			/>

			<box
				onMouseDown={() => onClose?.()}
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					right: 0,
					bottom: 0,
					zIndex: 101,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<box
					title={` ${heading} `}
					// without this a click on the panel bubbles to the layer behind it,
					// and reaching for something inside the dialog would close it
					onMouseDown={(event) => event.stopPropagation()}
					style={{
						width,
						flexDirection: "column",
						flexShrink: 0,
						paddingTop: 1,
						paddingLeft: modalMetrics.padding,
						paddingRight: modalMetrics.padding,
						paddingBottom: 1,
						border: true,
						borderColor: theme.lineActive,
						backgroundColor: theme.panel,
						// `overflow` must stay visible: the dismiss control below sits
						// outside the padding box, on the border row, and clipping the
						// panel deletes it silently — no error, just a modal with no
						// visible way out.
					}}
				>
					{/*
					 * Every modal gets this, from the primitive, because getting out is
					 * not a thing a modal should be able to forget. It is absolutely
					 * positioned at `top: -1`, which is the border row: children paint
					 * after the border, so it lands on top of it. The background is not
					 * decoration — without it the border shows through the spaces in the
					 * label and draws a dash through the middle of the words — which is
					 * why it is a `PressableText` at its resting colour rather than a
					 * bare label, and the hover comes along for free.
					 */}
					{onClose ? (
						<PressableText
							onPress={onClose}
							style={{
								position: "absolute",
								top: -1,
								right: 0,
								fg: theme.faint,
							}}
						>
							{` ${dismiss} `}
						</PressableText>
					) : null}

					{children}

					{hint ? (
						<text
							selectable={false}
							style={{ marginTop: 1, flexShrink: 0, fg: theme.faint }}
						>
							{hint}
						</text>
					) : null}
				</box>
			</box>
		</>
	);
}
