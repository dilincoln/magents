import { parseArgs } from "node:util";
import { setAttention } from "../../client/set-attention";
import { type Command, UsageError } from "../command";
import { short } from "../lib/columns";
import { logHookPayload, readHookPayload } from "../lib/hook-payload";
import { resolveSession } from "../lib/resolve-session";

/**
 * Marks a session as wanting somebody, or says it has been seen.
 *
 * This is the command the providers call — claude's `Stop`, `PermissionRequest`
 * and `Notification`, installed on the command line when the daemon spawns an
 * agent, and codex's `Stop` and `PermissionRequest`, which live in
 * `~/.codex/config.toml` and so apply to every codex session on the machine.
 * What both run is this, which is why it takes no
 * argument in the case that matters: a hook is a subprocess of the agent, so it
 * inherits `MAGENTS_SESSION` from the PTY the daemon gave it, and the command
 * can be a constant instead of an id threaded through JSON and then through an
 * argv.
 *
 * That the id travels in the environment is also what makes codex's global hook
 * harmless. A session magents started carries it and a session somebody opened
 * themselves does not, so the same command tells the two apart without knowing
 * anything about either.
 *
 * It is a real command rather than a hidden one because it is genuinely useful
 * by hand — a long build in another window can end by lighting the row you left
 * — and because a hidden command is one nobody can debug when a hook goes
 * quiet.
 */
export const attentionCommand: Command = {
	summary: "mark a session as wanting attention",
	usage: `magents attention — mark a session as wanting attention, or as seen

usage
  magents attention [<session>] [--clear]

arguments
  <session>   an id, the front of one, or the session's name.
              left out, \`MAGENTS_SESSION\` is used — which is what the
              provider hooks the daemon installs rely on, since a hook runs
              inside the agent's own process tree.

flags
      --clear   the opposite: this one has been seen
      --hook    speak the providers' hook protocol instead of English:
                \`{}\` on stdout, nothing on stderr, and always exit 0. a
                session it does not recognise — or none named at all — is
                ignored in silence, because codex runs this hook for every
                session on the machine and most of them are not ours. so is
                a hook fired from inside a subagent, which is a session
                still working rather than one wanting you.

                \`touch ~/.magents/hooks.debug\` and every payload a provider
                sends is written to ~/.magents/hooks.log until you take the
                switch away again
      --json    the row as the daemon's own JSON`,

	async run(argv) {
		const { values, positionals } = parseArgs({
			args: argv,
			options: {
				clear: { type: "boolean" },
				hook: { type: "boolean" },
				json: { type: "boolean" },
			},
			allowPositionals: true,
			strict: true,
		});

		/*
		 * Run by a provider, which is listening rather than reading.
		 *
		 * Three things are different and all three were learned the hard way.
		 *
		 * Codex parses a Stop hook's stdout as JSON and says so when it is not
		 * — `hook returned invalid stop hook JSON output`, printed into the
		 * agent's own transcript after every turn it completes — so the answer
		 * is `{}`: valid JSON with no fields, which is how both providers spell
		 * "no opinion".
		 *
		 * A session we do not know is not an error. Codex takes its hook from
		 * `~/.codex/config.toml` rather than from an argument, which means the
		 * hook is on *every* codex session on the machine, not only ours. Most
		 * of the time the right answer is to do nothing: no `MAGENTS_SESSION`
		 * is somebody working in their own terminal, and a stale one is a row
		 * that has since been removed. Neither is worth a word.
		 *
		 * A hook fired from inside a subagent is not this session asking for
		 * anybody either. It is the only thing here that reads the payload the
		 * provider writes on stdin — see `readHookPayload`, and the comment
		 * there for why `agent_id` is the field and `agent_type` is not.
		 *
		 * And it never fails for any other reason either. A daemon that is
		 * briefly not answering is a row that does not light up, which is a
		 * small thing; an agent printing an error under every turn is not.
		 * Swallowing is right here and would be wrong for the same command run
		 * by a person, which is the whole reason this is a flag rather than a
		 * guess about who is calling.
		 */
		if (values.hook) {
			const payload = await readHookPayload();
			await logHookPayload(payload);

			// Checked before the socket rather than after it, so the common cases
			// — a codex session that has nothing to do with magents, a worker
			// finishing inside a run that has not — cost a look at the
			// environment and at stdin, not a connection to a daemon that may not
			// even be running.
			const mine = positionals[0] ?? process.env.MAGENTS_SESSION;

			if (mine && !payload.agentId) {
				try {
					await mark(positionals[0], !values.clear);
				} catch {
					// deliberately nothing: see above
				}
			}

			console.log("{}");
			return;
		}

		const row = await mark(positionals[0], !values.clear);

		if (values.json) {
			console.log(JSON.stringify(row, null, 2));
			return;
		}

		console.log(
			`${short(row.id)}  ${row.title} — ${row.requiresAttention ? "wants attention" : "seen"}`,
		);
	},
};

/**
 * The whole of the work, so the two callers above share it rather than each
 * keeping a version of "which session did they mean".
 *
 * Resolved rather than sent as typed, which costs one extra call and buys a
 * name from a person. A hook passes a whole id, and the lookup is a prefix
 * match that finds it on the first comparison.
 */
const mark = async (ref: string | undefined, requiresAttention: boolean) => {
	const named = ref ?? process.env.MAGENTS_SESSION;

	if (!named) {
		throw new UsageError("which session? give an id, or set MAGENTS_SESSION");
	}

	const session = await resolveSession(named);
	return setAttention({ id: session.id, requiresAttention });
};
