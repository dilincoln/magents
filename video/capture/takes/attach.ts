// Attaching: the rate-limit agent has just finished; → attaches to it, a
// follow-up is typed straight into claude's own prompt and answered, and
// ⌃⌥← detaches again.
import type { Take } from "../record";
import { b, fresh, goto, release } from "./lib";

const stop = release("JIRA-2041");

export default {
	async setup() {
		await fresh(["review the API", "terraform"]);
		await goto("JIRA-2041");
	},
	actions: [
		{ at: b(-3), run: stop },
		{ at: b(2), keys: ["Right"] },
		{ at: b(4), type: "also send Retry-After on every 429", cps: 14 },
		{ at: b(11), keys: ["Enter"] },
		{ at: b(27), keys: ["C-M-Left"] },
		{ at: b(33), end: true },
	],
} satisfies Take;
