// Attention: you are reading one session while others finish in the
// background — each one's row lights up and pulses the moment it wants you.
import type { Take } from "../record";
import { b, fresh, goto, release } from "./lib";

const e2e = release("fix flaky checkout");
const ledger = release("JIRA-1979");

export default {
	async setup() {
		await fresh([]);
		await goto("migrate users");
	},
	actions: [
		{ at: b(0), run: e2e },
		{ at: b(8), run: ledger },
		{ at: b(15), run: ["./inns", "./mg", "attention", "review the API surface"] },
		{ at: b(26), end: true },
	],
} satisfies Take;
