// Agents outlive the UI: `q` quits the TUI back to the shell, and opening
// `magents` again finds every agent where it was, still working.
import type { Take } from "../record";
import { b, fresh, goto } from "./lib";

export default {
	async setup() {
		await fresh(["dark mode"]);
		await goto("JIRA-2041");
	},
	actions: [
		{ at: b(0), keys: ["q"] },
		{ at: b(4), type: "magents", cps: 8 },
		{ at: b(8), keys: ["Enter"] },
		{ at: b(14), keys: ["j"] },
		{ at: b(15), keys: ["j"] },
		{ at: b(26), end: true },
	],
} satisfies Take;
