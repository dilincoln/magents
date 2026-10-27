// The roster at a glance: the cursor hops from session to session every
// three beats and the right-hand pane follows it, showing each agent's own
// live screen. Group and project rows in between are skipped with extra
// presses inside the same beat, so the pane is never empty on a beat.
import type { Take } from "../record";
import { b, fresh, goto } from "./lib";

// how many rows down the next session is: migrate, review, OpenAPI docs,
// dark mode, fix flaky, JIRA-1979, terraform
const hops = [1, 2, 2, 3, 1, 2, 2];

export default {
	async setup() {
		await fresh(["review the API", "terraform", "dark mode"]);
		await goto("JIRA-2041");
	},
	actions: [
		...hops.flatMap((n, i) =>
			Array.from({ length: n }, (_, k) => ({ at: b(i * 3) + k * 0.05, keys: ["j"] })),
		),
		{ at: b(26), end: true },
	],
} satisfies Take;
