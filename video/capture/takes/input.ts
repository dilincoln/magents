// Keyboard and mouse: a few keys first, then the same kinds of thing with
// clicks — fold a group, pick a session, select text to copy it, open the
// spawn panel from its row and click away to close it.
import type { Take } from "../record";
import { b, fresh, goto } from "./lib";

export default {
	async setup() {
		await fresh([]);
		await goto("JIRA-2041");
	},
	actions: [
		{ at: b(0), keys: ["j"], label: "j" },
		{ at: b(1.5), keys: ["j"], label: "j" },
		{ at: b(3), keys: ["k"], label: "k" },
		{ at: b(5), keys: ["C-e"], label: "⌃e" },
		{ at: b(7), keys: ["C-e"], label: "⌃e" },
		{ at: b(10), click: "waiting on CI", dx: 4 },
		{ at: b(12.5), click: "waiting on CI", dx: 4 },
		{ at: b(15), click: "fix flaky", dx: 4 },
		{ at: b(18), drag: "I'll reproduce the flake", length: 44, ms: 900 },
		{ at: b(22), click: "spawn session", after: "ledger-core", dx: 3 },
		{ at: b(28), clickAt: [118, 33] },
		{ at: b(34), end: true },
	],
} satisfies Take;
