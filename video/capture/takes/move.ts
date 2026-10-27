// Groups: ⌃b moves a finished session into `Done`, a group set to hibernate,
// so its agent stops and the conversation stays. ⌃r brings it back.
import type { Take } from "../record";
import { b, fresh, goto } from "./lib";

export default {
	async setup() {
		await fresh([]);
		await goto("migrate users");
	},
	actions: [
		{ at: b(0), keys: ["C-b"] },
		{ at: b(3), keys: ["j"] },
		{ at: b(4), keys: ["j"] },
		{ at: b(6), keys: ["Enter"] },
		// the cursor stays on the row index, so walk down to where it landed
		...[10, 10.5, 11, 11.5].map((n) => ({ at: b(n), keys: ["j"] })),
		{ at: b(15), keys: ["C-r"] },
		{ at: b(26), end: true },
	],
} satisfies Take;
