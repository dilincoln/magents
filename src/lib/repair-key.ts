import type { KeyEvent } from "@opentui/core";

/**
 * Undoes an encoding bug in the embedded terminal, so that arrows reach the
 * agent.
 *
 * `EmbeddedTerminalRenderable.encodeKey` asks the native emulator for the bytes
 * to send, and hands it a *physical* key name for that — the W3C spelling,
 * `ArrowLeft` and `Home` and `Enter`. It works out that name one of two ways:
 * `key.code` verbatim when the event has one, and otherwise a lookup table on
 * `key.name`.
 *
 * The table is right and the shortcut is not. Nothing in OpenTUI's key parser
 * ever puts a W3C code on a `KeyEvent` — what it puts there is the tail of the
 * escape sequence the key arrived as, `"[D"` for left, `"[57350u"` for left
 * under the kitty protocol, `"OP"` for F1. The emulator does not recognise any
 * of those, so it answers with zero bytes and the key is silently dropped.
 *
 * Which is why typing worked and editing did not. A letter carries its own text
 * and never needs the physical name; every key that *only* exists as an escape
 * sequence needs it and never got it — the four arrows, home, end, delete, and
 * the function keys. That is most of what moving a cursor is.
 *
 * The repair is to take the unusable code off and let the table do its job.
 * Measured against the emulator, before and after:
 *
 * ```
 *   left        →  (nothing)   →  \e[D
 *   ctrl+left   →  (nothing)   →  \e[1;5D
 *   home        →  (nothing)   →  \e[H
 *   delete      →  (nothing)   →  \e[3~
 *   backspace   →  (nothing)   →  \x7f
 *   a           →  a           →  a          (untouched)
 * ```
 */

/**
 * The one family the lookup table does not cover, spelled the way the emulator
 * wants it. Everything else is already in there under its own name, and adding
 * a second copy here is how the two would come to disagree.
 */
const FUNCTION_KEYS: Record<string, string> = {
	f1: "F1",
	f2: "F2",
	f3: "F3",
	f4: "F4",
	f5: "F5",
	f6: "F6",
	f7: "F7",
	f8: "F8",
	f9: "F9",
	f10: "F10",
	f11: "F11",
	f12: "F12",
};

/**
 * Whether a `code` is one of the raw escape tails rather than a real name.
 *
 * `[` is a CSI tail and `O` is an SS3 one, which between them is every code the
 * parser produces. Narrow on purpose: a future OpenTUI that starts reporting
 * proper W3C codes should be left alone rather than have them thrown away.
 */
const isRawTail = (code: string): boolean =>
	code.startsWith("[") || code.startsWith("O");

/**
 * The same key with a physical name the emulator understands, or null when
 * there was nothing wrong with it.
 *
 * A plain object rather than a `KeyEvent`: `encodeKey` only reads fields, and
 * the alternative is mutating the event that other handlers are still holding.
 */
export function repairKey(key: KeyEvent): KeyEvent | null {
	if (!key.code || !isRawTail(key.code)) return null;

	return {
		...key,
		code: FUNCTION_KEYS[key.name.toLowerCase()],
	} as KeyEvent;
}

/**
 * The bytes to hand the agent for the one key the emulator cannot name at all.
 *
 * `linefeed` is what OpenTUI's parser calls the byte 0x0A on its own, and 0x0A
 * is what a terminal without kitty disambiguation sends for ⌃enter — and for
 * ⌃j, which is the same keystroke as far as that terminal is concerned. It is
 * the collision `⌃i`/tab and `⌃h`/backspace have in the roster, one level down.
 *
 * There is no physical key called linefeed, so `physicalKey` has no entry for
 * it, `encodeKey` answers with zero bytes, and the keystroke goes nowhere. That
 * is the whole of the bug: claude opens a new line for ⌃enter in a terminal of
 * its own and did nothing for it in a pane, because the pane never sent it
 * anything. Measured across every byte from 0x00 to 0x1f, this is the only one
 * that is dropped.
 *
 * So it is forwarded as it arrived, rather than re-keyed into ⌃enter and handed
 * back to the emulator — and that is the part that was measured rather than
 * reasoned about. With claude in the pane and the kitty protocol negotiated
 * between the two of them:
 *
 * ```
 *   \x0a        →  a second input line
 *   \e[13;5u    →  nothing at all        (the emulator's ⌃enter)
 *   \e[13;2u    →  a second input line   (⇧enter, for comparison)
 * ```
 *
 * claude answers the legacy byte and ignores the disambiguated ⌃enter, so
 * translating would have moved the key from one thing that does nothing to
 * another. The byte the terminal sent is also the byte claude gets when it is
 * run outside magents, which is the behaviour being restored.
 */
export function literalKey(key: KeyEvent): Uint8Array | null {
	if (key.name !== "linefeed") return null;

	const bytes = new TextEncoder().encode(key.sequence);
	return bytes.byteLength > 0 ? bytes : null;
}
