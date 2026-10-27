// The CLI: `magents-cli --help` to show how much of it there is, then one
// session per ticket from a `for` loop — recorded alongside the TUI, where
// the three rows appear by themselves.
import type { Take } from "../record";
import { tmux } from "../record";
import { b, fresh } from "./lib";

const SHELL = "main:shell";

export default {
	panes: { tui: "main:tui", shell: SHELL },
	async setup() {
		await fresh([]);
		tmux("resize-window", "-t", SHELL, "-x", "96", "-y", "24");
		tmux("send-keys", "-t", SHELL, "clear", "Enter");
		await Bun.sleep(2000);
	},
	actions: [
		{ at: b(0), type: "magents-cli --help", cps: 14, target: SHELL },
		{ at: b(4), keys: ["Enter"], target: SHELL },
		{ at: b(12), keys: ["C-l"], target: SHELL },
		{ at: b(13), type: "for t in JIRA-2101 JIRA-2102 JIRA-2103; do", cps: 20, target: SHELL },
		{ at: b(18), keys: ["Enter"], target: SHELL },
		{ at: b(19), type: '  magents-cli new -p claude -n $t --prompt "/jira-ticket $t"', cps: 26, target: SHELL },
		{ at: b(25), keys: ["Enter"], target: SHELL },
		{ at: b(26), type: "done", cps: 12, target: SHELL },
		{ at: b(27.5), keys: ["Enter"], target: SHELL },
		{ at: b(42), end: true },
	],
} satisfies Take;
