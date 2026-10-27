import type { CliRenderer } from "@opentui/core";

/**
 * The one door to the system clipboard, and it is OSC 52 on purpose.
 *
 * OSC 52 is how a program inside a terminal copies: it hands the bytes to the
 * emulator it is drawn in, and the emulator owns the clipboard. It is the
 * mechanism claude uses when it says "copied" — so on any terminal where
 * claude's own copy works, this one works, by construction. The alternatives
 * all know too much: `clip.exe`, `wl-copy`, `pbcopy` are a per-platform guess
 * about what is on the other side of the PTY, and over ssh every one of them
 * copies to the wrong machine. OSC 52 rides the connection that is already
 * there.
 *
 * A module-level sink rather than a hook, because the second caller is not a
 * component: the OSC 52 passthrough lives in `session-terminals`, outside
 * React, and both callers should mean exactly the same thing by "copy".
 */
let sink: CliRenderer | null = null;

/** Called once, when the screen has a renderer to hand over. */
export function installClipboard(renderer: CliRenderer): void {
	sink = renderer;
}

/**
 * Puts text on the clipboard. Quietly does nothing before the screen exists —
 * there is nobody selecting anything before then either.
 */
export function copyText(text: string): void {
	if (text.length === 0) return;
	sink?.copyToClipboardOSC52(text);
}
