import { theme } from "./theme";

/**
 * The background of a row that wants looking at, at a given moment.
 *
 * A wash of the accent over whatever is underneath, whose *alpha* is what
 * moves. Blinking — swapping between two colours — is the obvious way to do
 * this and is the wrong one twice over: it reads as a fault rather than a
 * notice, and in a terminal it lands as a hard flash across a character cell
 * with nothing in between. A ramp is quieter and easier to have on screen for
 * as long as this may be, which is until somebody comes back.
 *
 * Alpha and not two mixed colours because the buffer already blends: an
 * eight-digit hex is composited with what is beneath rather than covering it,
 * which is the same property `theme.veil` is built on. So one colour is enough,
 * the row underneath keeps its own identity — selected, hovered, plain — and
 * this is a layer over it rather than a replacement for it.
 */

/** A whole breath, in seconds. Slow enough to read as breathing, not flashing. */
const PERIOD = 1.8;

/**
 * How far the wash goes.
 *
 * The floor is not zero. A row that passes through fully transparent has a
 * moment of looking exactly like every other row, and a glance that lands in
 * that moment sees nothing — so the bottom of the ramp still says "this one",
 * and the movement is what draws the eye to it.
 */
const MIN = 0.08;
const MAX = 0.3;

/** `#rrggbbaa` for the accent at this point in the cycle. */
export const pulse = (seconds: number): string => {
	// cosine rather than a sawtooth: the ends are where it lingers, so the
	// brightest and dimmest moments are the ones long enough to notice
	const wave = (1 - Math.cos((seconds / PERIOD) * 2 * Math.PI)) / 2;
	const alpha = MIN + (MAX - MIN) * wave;

	return `${theme.attention}${Math.round(alpha * 255)
		.toString(16)
		.padStart(2, "0")}`;
};
