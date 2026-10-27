import { cliCommand } from "../paths/cli-path";

/**
 * The hooks the daemon installs on an agent so it can say when it wants you.
 *
 * The problem they solve is that a session is only interesting at the moments
 * nobody is looking at it. An agent working is not news; an agent that has
 * finished, or that has stopped to ask permission, is — and if you are watching
 * a different session at the time, nothing on the screen changes and you find
 * out by wandering back.
 *
 * The provider is the only thing that knows when those moments happen. Both of
 * them can be told to run a command at them, so the command is ours: our own
 * CLI, marking the row.
 *
 * They are told by different routes, and the routes are not interchangeable —
 * claude takes its hooks on the command line, codex takes its from its own
 * config file. Each is argued for where it is built, below.
 *
 * **Which session** is not in the command. It travels in the environment as
 * `MAGENTS_SESSION`, set on the PTY child by `terminals.ts`, and it gets to the
 * hook because a hook is a subprocess of the agent — measured, along with the
 * shell it runs under:
 *
 *   session=[01a04a18-dead-beef-cafe-000000000001] shell=/bin/sh
 *
 * That keeps the command a constant. Interpolating an id into a JSON string
 * that is then interpolated into an argv is two levels of quoting to get wrong,
 * and the id is a thing the child already has.
 *
 * One thing is *not* in the environment and has to be read off the hook's
 * stdin: whether the hook fired inside a subagent. A worker finishing is not
 * the session wanting you, and it inherits `MAGENTS_SESSION` like everything
 * else in the process tree. See `readHookPayload`.
 */

/**
 * What a hook runs. Reads the id from its own environment — see above.
 *
 * `--hook` is not decoration. A provider reads the command's stdout as part of
 * a protocol — codex parses a Stop hook's as JSON and prints
 * `hook returned invalid stop hook JSON output` into the agent's transcript
 * when it is not — and it must never fail loudly, because a daemon that is
 * briefly not answering would otherwise put an error under every turn the agent
 * completes. The flag says which of the two audiences is calling; see the
 * command itself.
 *
 * It is also why this string is worth settling once. Codex records trust
 * against the command, so changing it asks the user to accept the hook again on
 * every machine.
 */
export const hookCommand = (): string => `${cliCommand()} attention --hook`;

/**
 * The moments a provider is asked to report, by the names each gives them.
 *
 * `Stop` is "it finished". `PermissionRequest` is "it is about to ask you" —
 * a shell escalation, a write outside the sandbox, a tool that wants a yes.
 * Both providers spell both the same way, which is what lets one list serve
 * two very different routes below.
 *
 * `PermissionRequest` is not the first answer either provider gives for "it
 * is waiting", and it was measured against the others before being chosen.
 * Claude's `Notification` covers the same prompt, and more besides — it is
 * kept — but it arrives six seconds after the dialog does, and
 * `PermissionRequest` arrives with it. Codex has nothing else: its `Stop`
 * fires when the turn ends, and a turn that is stopped on an approval has not
 * ended, so a codex row waiting on a yes stayed dark for as long as you took
 * to notice. Both were watched fire, on a real prompt, with the hook's stdout
 * going in — `{}`, which both providers read as "no decision" and go on to
 * show the dialog exactly as they would have.
 */
export const HOOK_EVENTS = ["Stop", "PermissionRequest"] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

/**
 * Claude's, as an argv fragment.
 *
 * The two events above, and `Notification` besides: that one is "it is
 * waiting for you" in every form claude has — the idle prompt, a question put
 * to the user, an MCP elicitation — and `PermissionRequest` is only the
 * quickest of them. Between them they cover the ways an agent stops needing
 * the model and starts needing a person.
 *
 * `--settings` with JSON inline, and the objection this file had to answer is
 * the one written next to `CLAUDE_CODE_DISABLE_AGENT_VIEW`: that the flag would
 * "take the place of whatever settings the user passes claude themselves, which
 * is theirs and not ours to replace". For hooks that turns out to be false, and
 * it was worth measuring rather than reasoning about — with a `Stop` hook in the
 * project's own `.claude/settings.json` and a different one passed here, both
 * ran:
 *
 *   --- hooks that fired ---
 *   THEIRS
 *   OURS
 *
 * So this adds a hook rather than replacing a settings file. The env var stays
 * the right home for `disableAgentView` regardless — that one *is* a scalar
 * setting, and a scalar does get replaced.
 */
export const claudeHookArgs = (): string[] => {
	const group = [{ hooks: [{ type: "command", command: hookCommand() }] }];

	return [
		"--settings",
		JSON.stringify({
			hooks: {
				...Object.fromEntries(HOOK_EVENTS.map((event) => [event, group])),
				Notification: group,
			},
		}),
	];
};

/**
 * Codex's, as a block for its config file — one array per event above.
 *
 * Not an argv, and that is the change worth explaining. The same hook used to
 * ride in on `-c hooks.Stop=…` next to the model and the reasoning effort, and
 * on paper it was the tidier arrangement: nothing of ours in the user's config,
 * every session carrying its own instructions. In practice it fired sometimes
 * and not others — the same session, the same command, a turn that reported and
 * then a turn that did not — and an attention light that is right most of the
 * time is worse than none, because you stop trusting the dark rows.
 *
 * The config file does not have that problem. `-c` is an override on one
 * invocation, and an override is only as reliable as the invocation carrying
 * it; a hook in `~/.codex/config.toml` is simply what codex does. So this is
 * written once, by `install.sh`, and the daemon passes nothing.
 *
 * What that buys is also what it costs: the hook now fires for **every** codex
 * session on the machine, including ones magents has never heard of. That is
 * fine and it is the reason `MAGENTS_SESSION` was always the way the id
 * travelled — a session we started has it, anybody else's does not, and the
 * command's job in that case is to do nothing quietly. See `attention --hook`.
 *
 * Codex also puts `session_id`, `turn_id` and `transcript_path` on the hook's
 * stdin. Nothing here reads them — the environment already carries the one id
 * this needs — but they are there if a hook ever needs more than which row it
 * is about.
 *
 * **It still asks.** A hook codex has not been told to trust is skipped in
 * silence, wherever it was declared, and the way it is told is by asking the
 * person. Accepting persists, which is why `install.sh` writes this and then
 * offers to open codex once so the question can be answered.
 */
export const codexHookConfig = (): string =>
	[
		"[hooks]",
		...HOOK_EVENTS.map((event) => `${event} = [${codexHookEntry()}]`),
	].join("\n");

/**
 * The same hook as one element of a `hooks.<event>` array, which is what it
 * is when the file already has that array to go into.
 *
 * A codex hook entry is a *group* — a list of hooks that run together — so
 * ours is a group of one. Adding a group beside theirs rather than a hook
 * inside theirs is the smaller change: it leaves their group exactly as it was,
 * which matters because a group is where matchers and ordering live.
 */
export const codexHookEntry = (): string =>
	`{ hooks = [{ type = "command", command = "${toml(hookCommand())}" }] }`;

/**
 * The same entry again, spelled as an array-of-tables section.
 *
 * TOML will not let an array written inline be extended by a later
 * `[[hooks.Stop]]` — "cannot mutate immutable namespace" — but it is perfectly
 * happy to *start* one that way, or to add to one already written that way.
 * Which makes this the shape to append when the file has hooks of somebody
 * else's: it needs no edit inside their lines, only a block at the end.
 */
export const codexHookTable = (event: HookEvent): string =>
	[
		`[[hooks.${event}]]`,
		`hooks = [{ type = "command", command = "${toml(hookCommand())}" }]`,
	].join("\n");

/**
 * A TOML basic string's worth of escaping, which is the two characters that can
 * end one early. The command is a path we built, so this is a guard rather than
 * a hot path — but a home directory with a quote in it is a legal home
 * directory, and the failure would be codex refusing to parse its own config.
 */
const toml = (value: string): string =>
	value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
