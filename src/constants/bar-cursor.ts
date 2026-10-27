import type { CursorStyleOptions } from "@opentui/core";

/**
 * The cursor shape for every `<input>` and `<textarea>` in the app.
 *
 * OpenTUI's default is a blinking block, which reads as vim's normal mode:
 * the shape that says "keys are commands here". A form field is the opposite
 * promise — what you type goes in — and the thin bar is the shape every other
 * text field on the machine uses to make it. Same intent as the pane's own
 * default in `session-terminals.ts`: unless someone inside asks for a block,
 * the cursor is a bar.
 */
export const barCursor: CursorStyleOptions = { style: "line", blinking: true };
