// Spawning: ⌃n opens the prompt box in the project you are in, ⌃p picks the
// provider, `/` offers the project's skills, ⌃s sends it — and the new
// session's row is in the roster straight away.
import type { Take } from "../record";
import { b, fresh, goto } from "./lib";

export default {
	async setup() {
		await fresh([]);
		await goto("JIRA-2041");
	},
	actions: [
		{ at: b(0), keys: ["C-n"] },
		{ at: b(3), keys: ["C-p"] },
		{ at: b(6), type: "/wri", cps: 8 },
		{ at: b(9), keys: ["Tab"] },
		{ at: b(10), type: "add an index on users.email", cps: 14 },
		{ at: b(17), keys: ["C-s"] },
		{ at: b(26), end: true },
	],
} satisfies Take;
