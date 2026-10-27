/**
 * Watches a byte stream for DECSCUSR — `CSI Ps SP q`, the sequence a program
 * uses to choose its cursor's shape (1/2 block, 3/4 underline, 5/6 bar).
 *
 * Not to act on it — the emulator already parses it and the pane already
 * relays it — but to know *whether the program inside ever chose at all*. The
 * emulator reports a resolved style with "block" as its default, so a child
 * that never asked is indistinguishable from one that asked for a block; this
 * watcher is what tells those apart, and the pane uses the answer to give an
 * unstyled child a bar instead of the emulator's block. See `session-terminals`.
 *
 * Stateful across chunks for the same reason the OSC 52 scanner is: the ESC
 * can end one socket frame and the `[` open the next.
 */

const ESC = 0x1b;
const BRACKET = 0x5b; // "["
const SPACE = 0x20;
const FINAL_Q = 0x71; // "q"

type State = "ground" | "esc" | "params" | "intermediate";

export interface DecscusrWatch {
	push(bytes: Uint8Array): void;
	reset(): void;
}

export function createDecscusrWatch(
	/** Ps as sent — 0 (or nothing) is "back to the terminal's default" */
	onStyle: (ps: number) => void,
): DecscusrWatch {
	let state: State = "ground";
	let params = "";
	let spaced = false;

	return {
		push(bytes) {
			for (const byte of bytes) {
				if (state === "ground") {
					if (byte === ESC) state = "esc";
				} else if (state === "esc") {
					state = byte === BRACKET ? "params" : "ground";
					params = "";
					spaced = false;
				} else if (state === "params" || state === "intermediate") {
					if (byte >= 0x30 && byte <= 0x3f && state === "params") {
						// parameter bytes; more than one CSI param means some other
						// control, and eight digits of Ps means garbage
						if (params.length < 8) params += String.fromCharCode(byte);
						else state = "ground";
					} else if (byte === SPACE) {
						spaced = true;
						state = "intermediate";
					} else if (byte >= 0x40 && byte <= 0x7e) {
						// the final byte, whatever it is, ends the sequence
						if (byte === FINAL_Q && spaced && /^\d*$/.test(params)) {
							onStyle(params === "" ? 0 : Number(params));
						}
						state = "ground";
					} else if (byte >= 0x20 && byte <= 0x2f) {
						// some other intermediate — a valid CSI, not this one
						state = "intermediate";
					} else {
						// a stray control byte aborts the sequence
						state = byte === ESC ? "esc" : "ground";
					}
				}
			}
		},
		reset() {
			state = "ground";
			params = "";
			spaced = false;
		},
	};
}
