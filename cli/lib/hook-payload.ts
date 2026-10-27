import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { magentsHome } from "../../daemon/paths/magents-home";

/**
 * What the provider wrote on the hook's stdin, as much of it as we care about.
 *
 * Both providers put a JSON object there and neither of them was being read
 * until a session started lighting its row once per subagent. Claude's `Stop`
 * is main-thread only — `SubagentStop` is a separate event we do not register —
 * but `Notification` is not, and a run that fans out to a dozen workers is a
 * dozen reasons to look at a session that has not finished anything.
 *
 * The field that settles it is `agent_id`, and the SDK's own types say so in
 * as many words:
 *
 *   Subagent identifier. Present only when the hook fires from within a
 *   subagent (e.g., a tool called by an AgentTool worker). Absent for the main
 *   thread, even in --agent sessions. Use this field (not agent_type) to
 *   distinguish subagent calls from main-thread calls.
 *
 * `agent_type` is called out there as the wrong one, and it is worth saying why
 * rather than just obeying: it is also set on the main thread of a session
 * started with `--agent`, so filtering on it would put out the light for
 * anybody who runs claude that way.
 *
 * Codex sends no such field, which costs nothing: absent means main, and for
 * codex that is always the true answer.
 */
export interface HookPayload {
	/** the subagent this came from, when it came from one */
	readonly agentId: string | null;
	/** `Stop`, `Notification`, whatever the provider calls it */
	readonly event: string | null;
	/** the whole thing, for the log */
	readonly raw: string;
}

const EMPTY: HookPayload = { agentId: null, event: null, raw: "" };

/**
 * How long to wait for it before deciding there is none.
 *
 * A provider writes the object and closes the pipe, so this is reached only
 * when something is wrong. It has to exist regardless: a hook that blocks is an
 * agent that blocks, and the whole point of `--hook` is that this command
 * cannot be the reason a turn hangs. Timing out lands on the old behaviour —
 * no payload, so nothing is filtered — which is the right way to fail.
 */
const STDIN_MS = 500;

export async function readHookPayload(): Promise<HookPayload> {
	// A terminal never sends EOF on its own, so reading one waits for a person
	// to press ⌃d. That is not a hook, it is somebody trying the command by
	// hand, and it must not hang on them.
	if (process.stdin.isTTY) return EMPTY;

	const raw = await withDeadline();

	if (!raw.trim()) return EMPTY;

	let body: Record<string, unknown>;
	try {
		body = JSON.parse(raw) as Record<string, unknown>;
	} catch {
		// Not JSON, so not a shape this knows how to read. Unreadable is not the
		// same as "from a subagent", and guessing the strict answer would put out
		// a light somebody wanted.
		return { ...EMPTY, raw };
	}

	return {
		agentId: text(body.agent_id),
		event: text(body.hook_event_name),
		raw,
	};
}

/**
 * stdin, or nothing if it does not turn up in time.
 *
 * The `clearTimeout` is not tidiness. A pending timer keeps the process alive,
 * so without it this reads the payload in a millisecond and then sits out the
 * rest of the deadline before exiting — measured at 530ms on every hook,
 * whatever was on stdin. The timer is not `unref`'d instead, which would also
 * have fixed the exit: an unreferenced timer stops being able to end a read
 * that has genuinely stalled, and a stalled read is the only reason it exists.
 */
async function withDeadline(): Promise<string> {
	let timer: ReturnType<typeof setTimeout> | undefined;

	try {
		return await Promise.race([
			Bun.stdin.text().catch(() => ""),
			new Promise<string>((resolve) => {
				timer = setTimeout(() => resolve(""), STDIN_MS);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

const text = (value: unknown): string | null =>
	typeof value === "string" && value ? value : null;

/** Touch this and every hook payload is written down; remove it and they stop. */
const SWITCH = join(magentsHome, "hooks.debug");
const LOG = join(magentsHome, "hooks.log");

/**
 * The payload, in a file, when somebody has asked for it.
 *
 * A file rather than an environment variable, and that is the whole reason it
 * is usable: a hook is a grandchild of the daemon, which is a systemd service,
 * so an env var means editing a unit and restarting everything — by which point
 * whatever you were trying to catch has been and gone. `touch
 * ~/.magents/hooks.debug`, reproduce it, read `~/.magents/hooks.log`, delete
 * the switch.
 *
 * Never throws, like everything else on this path.
 */
export async function logHookPayload(payload: HookPayload): Promise<void> {
	try {
		if (!(await Bun.file(SWITCH).exists())) return;

		const session = process.env.MAGENTS_SESSION ?? "-";
		await appendFile(
			LOG,
			`${new Date().toISOString()} session=${session} ${payload.raw || "(no stdin)"}\n`,
		);
	} catch {
		// deliberately nothing: a debugging aid that can fail a turn is worse
		// than no debugging aid
	}
}
