// Search: `/` and a word narrows the roster across every project — by name,
// project, provider or model.
import type { Take } from "../record";
import { b, fresh } from "./lib";

export default {
	async setup() {
		await fresh([]);
	},
	actions: [
		{ at: b(0), keys: ["/"] },
		{ at: b(1), type: "codex", cps: 8 },
		...[6, 6.5, 7, 7.5].map((n) => ({ at: b(n), keys: ["Down"] })),
		{ at: b(12), keys: ["C-u"] },
		{ at: b(13), type: "opus", cps: 8 },
		{ at: b(22), keys: ["Escape"] },
		{ at: b(26), end: true },
	],
} satisfies Take;
