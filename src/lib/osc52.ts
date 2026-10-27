/**
 * Watches a byte stream for OSC 52 — the escape sequence a program emits to
 * copy to the clipboard: `ESC ] 52 ; <target> ; <base64> BEL` (or `ESC \`).
 *
 * The agent in a pane is such a program. claude's copy-on-select says "copied"
 * because it emitted exactly this — into *our* emulator, which parses it and
 * does nothing, so the words were true and the clipboard was not. This scanner
 * sits on the stream before the emulator, spots the sequence, and hands the
 * decoded text to whoever can actually reach a clipboard. It only observes:
 * the bytes go to the emulator unchanged.
 *
 * Stateful, because a sequence does not respect chunk boundaries — the ESC can
 * be the last byte of one socket frame and the `]` the first of the next.
 */

/** xterm caps OSC 52 near 100KB of base64; anything past this is not a copy. */
const LIMIT = 512 * 1024;

const ESC = 0x1b;
const BEL = 0x07;
const CLOSE = 0x5d; // "]"
const BACKSLASH = 0x5c;

type State = "ground" | "esc" | "collect" | "collect-esc";

export interface Osc52Scanner {
	push(bytes: Uint8Array): void;
	/** back to ground — a replay reset means any half-seen sequence is dead */
	reset(): void;
}

export function createOsc52Scanner(
	onCopy: (text: string) => void,
): Osc52Scanner {
	let state: State = "ground";
	let collected: number[] = [];
	let overflow = false;

	const finish = (): void => {
		state = "ground";
		const bytes = collected;
		collected = [];

		// a sequence past the cap was truncated on the way in, and a truncated
		// copy is a corrupted one — dropping it is the only honest outcome
		if (overflow) {
			overflow = false;
			return;
		}

		// `52;<target>;<data>` — anything else is some other OSC, not ours
		if (String.fromCharCode(...bytes.slice(0, 3)) !== "52;") return;

		const at = bytes.indexOf(0x3b, 3); // the ";" after the target
		if (at === -1) return;
		const data = bytes.slice(at + 1);

		// "?" asks the terminal what the clipboard holds — a question, not a copy
		if (data.length === 0 || (data.length === 1 && data[0] === 0x3f)) return;

		try {
			// through Buffer at both steps: base64 arrives as ASCII bytes, and a
			// spread into fromCharCode would blow the stack on a payload this
			// size — the cap is half a megabyte, not sixty-four characters
			const text = Buffer.from(
				Buffer.from(data).toString("ascii"),
				"base64",
			).toString("utf8");
			if (text.length > 0) onCopy(text);
		} catch {
			// malformed base64 is a broken program, not our problem to report
		}
	};

	return {
		push(bytes) {
			for (const byte of bytes) {
				if (state === "ground") {
					if (byte === ESC) state = "esc";
				} else if (state === "esc") {
					state = byte === CLOSE ? "collect" : "ground";
					collected = [];
					overflow = false;
				} else if (state === "collect") {
					if (byte === BEL) finish();
					else if (byte === ESC) state = "collect-esc";
					else if (collected.length < LIMIT) collected.push(byte);
					else overflow = true;
				} else if (state === "collect-esc") {
					// ESC \ is the other legal terminator; ESC anything-else means
					// the sequence was abandoned mid-air
					if (byte === BACKSLASH) finish();
					else {
						state = byte === ESC ? "esc" : "ground";
						collected = [];
					}
				}
			}
		},
		reset() {
			state = "ground";
			collected = [];
			overflow = false;
		},
	};
}
