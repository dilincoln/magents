import { dlopen, FFIType } from "bun:ffi";
import { mkdirSync, openSync, statSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { magentsHome } from "../../daemon/paths/magents-home";

/**
 * Takes the terminal's error stream away from everything that is not the
 * renderer, and points it at a file.
 *
 * A program that owns the screen cannot share the screen. The renderer writes
 * frames to stdout and keeps a model of what every cell holds; anything else
 * that writes to the terminal lands wherever the cursor happens to be, in cells
 * the renderer believes it already knows, and stays there until something
 * redraws over it.
 *
 * That is not hypothetical and it is not ours. `libopentui.so` — the native
 * emulator, written in Zig — logs at *info* level straight to fd 2:
 *
 *   info(page_list): adjusting page capacity=.{ .cols = 157, .rows = 296,
 *   .styles = 128, .hyperlink_bytes = 384, ... }
 *
 * It fires when a page grows to hold more distinct styles, hyperlinks or
 * graphemes, which is what a heavily coloured agent redrawing its screen does —
 * measured at 209 lines from one burst of styled output. On screen it arrives as
 * a sentence across row three or four of the whole terminal, outside every box,
 * half of it wiped by the next frame that happens to cover those cells.
 *
 * Zig's log level is fixed at compile time and the library exposes no switch
 * for it (the strings in the binary offer `OPENTUI_GRAPHICS`, `OPENTUI_CLIPBOARD`
 * and a dozen others, and nothing for logging), so there is nothing to ask
 * politely. What is left is the file descriptor, and it is enough: the library
 * writes to fd 2 rather than through anything in JavaScript, so replacing what
 * fd 2 *points at* catches it — `process.stderr` and `console.error` would not.
 *
 * `dup2` through libc, because neither Bun nor node:fs exposes it. If no libc
 * opens — a platform this has not met — nothing happens and the log lines come
 * back. That is the right failure: they are ugly, not fatal.
 */

/** Where the lines go instead. Truncated per run: this is the log for now. */
export const stderrLog = join(magentsHome, "tui.log");

/** glibc, musl, macOS. Tried in turn; none of them is an error. */
const LIBCS = ["libc.so.6", "libc.musl-x86_64.so.1", "libSystem.B.dylib"];

const libc = () => {
	for (const name of LIBCS) {
		try {
			return dlopen(name, {
				dup: { args: [FFIType.i32], returns: FFIType.i32 },
				dup2: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
			}).symbols;
		} catch {
			// not this one
		}
	}
	return null;
};

export function quietStderr(): void {
	const c = libc();
	if (!c) return;

	let target: number;

	try {
		mkdirSync(dirname(stderrLog), { recursive: true });
		target = openSync(stderrLog, "w");
	} catch {
		// a home we cannot write to is not a reason to refuse to start
		return;
	}

	// kept so the stream can be given back, which is the half that matters when
	// something goes wrong: an uncaught exception prints to fd 2, and a crash
	// whose only trace went to a file nobody was told about is a crash with no
	// message at all
	const saved = c.dup(2);
	c.dup2(target, 2);

	process.on("exit", (code) => {
		if (saved >= 0) c.dup2(saved, 2);
		if (code === 0) return;

		// Only on the way out badly. On an ordinary quit the file is a few hundred
		// lines of somebody else's info logging and saying so every time would be
		// the noise this exists to remove.
		try {
			if (statSync(stderrLog).size > 0) {
				writeSync(
					2,
					`magents: output was kept off the screen — ${stderrLog}\n`,
				);
			}
		} catch {
			// the pointer is a courtesy; failing to print it changes nothing
		}
	});
}
