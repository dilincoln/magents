import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./app";
import { quietStderr } from "./lib/quiet-stderr";
import { theme } from "./lib/theme";

// First, and before the renderer exists: from here on this program owns the
// screen, and the native emulator logs to fd 2 without asking. See the file.
quietStderr();

// mouse tracking is explicit, not assumed: the roster, the search field and the
// modal are all clickable, and every one of them is dead without it.
//
// The keyboard protocol is asked for just as explicitly, and for one reason:
// without it a terminal sends a bare carriage return for both `enter` and
// `⌃enter`, so the two are the same key and `⌃enter spawn` cannot exist. With
// disambiguation on, a terminal that supports it sends `\u001b[13;5u` and they
// are two keys again. Only escape codes are disambiguated — ordinary text is
// still ordinary text, which matters because it is forwarded to the agent's
// own CLI in the pane.
const renderer = await createCliRenderer({
	targetFps: 60,
	useMouse: true,
	useKittyKeyboard: { disambiguate: true },
});
renderer.setBackgroundColor(theme.bg);

createRoot(renderer).render(<App />);
renderer.start();
