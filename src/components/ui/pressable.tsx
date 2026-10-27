import type { BoxRenderable, MouseEvent } from "@opentui/core";
import type { BoxProps, TextProps } from "@opentui/react";
import { type ReactNode, useState } from "react";
import { theme } from "../../lib/theme";

/**
 * Whether the pointer is on this, and the two handlers that keep the answer
 * true.
 *
 * OpenTUI sends `over` and `out` to the deepest renderable under the pointer
 * and then bubbles them, which is what makes this safe to put on a row that
 * contains its own smaller buttons: moving from the row onto the `×` inside it
 * fires `out` on the row and `over` on the `×`, and the `over` bubbles back
 * through the row. Both land in the same synchronous dispatch, React batches
 * them, and the row stays lit rather than blinking off on the way in.
 *
 * It needs no cleanup on unmount. `out` is not what makes this false when the
 * component goes away — the state goes away with it — and the renderer sends
 * `out` to a destroyed renderable at most once, guarded on its own side.
 */
function useHovered() {
	const [hovered, setHovered] = useState(false);

	return {
		hovered,
		onMouseOver: () => setHovered(true),
		onMouseOut: () => setHovered(false),
	};
}

interface Press {
	/**
	 * What the click does.
	 *
	 * Also what decides whether there is a hover at all: no handler, no
	 * highlight. A pointer that lights something up is promising that pressing
	 * it does something, and the roster has headings that are drawn like rows
	 * and are not rows — an unregistered group has nothing behind it to select.
	 */
	onPress?: (event: MouseEvent) => void;
	/**
	 * A name the renderer can find it by. The roster gives one to every row
	 * the cursor can land on, so the list can be scrolled to whichever is
	 * selected without knowing where in the tree it was drawn.
	 */
	id?: string;
	/** the colour at rest */
	background?: string;
	/**
	 * the colour under the pointer. Pass the resting colour to opt out, which is
	 * what a row that is already selected wants: `hover` is a step up from
	 * `panel` and a step down from `lineActive`, so applying it to the selected
	 * row would dim the selection to say the mouse is near it.
	 */
	hover?: string;
	children?: ReactNode;
}

/**
 * A clickable box that says so when the pointer is on it.
 *
 * Two shapes, one behaviour, because the renderer has two shapes: a box paints
 * `backgroundColor` and takes children of any kind, a text paints `bg` and
 * takes spans. Anything with more than one colour in it — a row with a mark, a
 * name and a badge — has to be a box; a single run of text is cheaper as text.
 * The rule about what a hover means lives in one place either way.
 *
 * The effect is only ever the background. Moving the pointer across a list
 * should not move any of the text in it, and a hover that also changed the
 * foreground would compete with the selection, which is the state that actually
 * decides what the keys do.
 */
export function Pressable({
	onPress,
	id,
	background = theme.panel,
	hover = theme.hover,
	style,
	ref,
	children,
}: Press & {
	style?: BoxProps["style"];
	/**
	 * The box itself, for the one thing React should not be doing: animation.
	 *
	 * A colour that changes every frame cannot be a prop — that is sixty renders
	 * a second of a list — so whoever wants one takes the renderable and writes
	 * to it directly, which is the arrangement `useFrame` exists for and the
	 * wordmark already uses. Nothing else needs this.
	 */
	ref?: React.Ref<BoxRenderable>;
}) {
	const { hovered, onMouseOver, onMouseOut } = useHovered();

	return (
		<box
			ref={ref}
			id={id}
			onMouseDown={onPress}
			onMouseOver={onMouseOver}
			onMouseOut={onMouseOut}
			style={{
				...style,
				backgroundColor: hovered && onPress ? hover : background,
			}}
		>
			{children}
		</box>
	);
}

/** {@link Pressable}, for a label rather than a layout. */
export function PressableText({
	onPress,
	id,
	background = theme.panel,
	hover = theme.hover,
	style,
	children,
}: Press & { style?: TextProps["style"] }) {
	const { hovered, onMouseOver, onMouseOut } = useHovered();

	return (
		// never selectable: these are buttons, and dragging across one to copy the
		// word on it is not what the drag was for
		<text
			id={id}
			selectable={false}
			onMouseDown={onPress}
			onMouseOver={onMouseOver}
			onMouseOut={onMouseOut}
			style={{ ...style, bg: hovered && onPress ? hover : background }}
		>
			{children}
		</text>
	);
}
