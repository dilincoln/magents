---
name: magents
description: Use when opening, listing, renaming, moving, or fanning out background coding-agent sessions from a shell — "/magents", "create N sessions", "one session per ticket", "list my agent sessions", "which session needs me", "magents is not connected" — or when a magents command errors on a flag or floods the terminal.
---

# magents

Provider-agnostic control plane for coding agents. `magents-daemon` listens on
`~/.magents/daemon.sock` and holds every agent's terminal; the CLI opens sessions
on it and moves them around. A session hangs under a **project** (a registered
folder) and optionally a **group** (a bucket inside that project).

## The binary is `magents-cli`

`magents` is the **TUI**. It ignores `--help`, seizes the terminal, and floods a
non-interactive shell with hundreds of KB of escape sequences. Never run it from
an agent shell — not even to check a flag. If you did, `reset` or `stty sane`
restores the terminal.

Both binaries are the same build, so every usage line the CLI prints says
`magents`. Read those as `magents-cli`. `magents-cli <command> --help` is safe
and is the authority on flags — this table is a summary, not the full surface.

## Quick reference

| Need | Command |
|---|---|
| open a session | `magents-cli new -p <claude\|codex> --prompt <text> [-n <name>] [-g <group>] [--project <ref>] [-m <model>] [--variant <id>]` |
| long prompt | `magents-cli new -p claude -n "port the parser" --prompt - < brief.md` |
| list sessions | `magents-cli sessions [--project <ref>]` |
| list projects | `magents-cli projects` |
| list groups | `magents-cli groups [--project <ref>]` |
| create a group | `magents-cli groups add <title> [--default] [--hibernates]` |
| rename a session | `magents-cli rename <session> <name>` |
| regroup a session | `magents-cli move <session> <group>` / `--none` |
| flag / unflag attention | `magents-cli attention [<session>] [--clear]` |
| what a provider runs | `magents-cli models <claude\|codex>` |
| hook wiring | `magents-cli hooks <claude\|codex> [--write]` |

Every command takes `--json`. Use it whenever the output feeds a later step — the
human tables are aligned for eyes and their columns are not stable.

`models` **is not instant**: the daemon boots the provider's CLI to answer.

## Refs are loose, flags are not

A `<session>`, `<group>`, or `<project>` ref is an id, the **front of an id**, or
the thing's own title — quote titles with spaces or emoji (`-g "💻 Working"`).
`--project` defaults to the cwd and registers the folder if it isn't a project
yet. `move` has no `--project`: naming the session already settled it. In a
script, prefer ids; titles are not guaranteed unique.

A group ref that matches nothing is an **error listing the real groups**, exit 1 —
it is never created for you. `groups add` first.

`-p` is `new`'s provider flag and **nothing else's**. `models` takes the provider
as a bare positional (`magents-cli models claude`); `models -p claude` errors.

## What `new` actually spawns

The daemon launches the provider in the **project directory** — no worktree, no
sandbox of its own — with the magents session id as the provider's session id,
the prompt as a plain argument, and `-m` / `--variant` passed through as the
provider's own model and effort flags. So the agent inherits that folder's
`CLAUDE.md`/`AGENTS.md` and settings, and a prompt like `/do JIRA-1979` runs as if
typed there.

The daemon also installs hooks that call `magents-cli attention --hook` on the
provider's Stop, PermissionRequest, and Notification events. **That flag is the
completion signal** — `requiresAttention` flips true when the agent finishes a
turn or blocks on a permission prompt.

## Fanning out one session per work item

```bash
for t in JIRA-1979 JIRA-1980; do
  magents-cli new -p claude -n "$t" -g "💻 Working" \
    --project ~/code/atlas-api --prompt "/do $t" --json
done
```

`-n` is cosmetic and defaults to the prompt's first line. Confirm from JSON, not
by grepping the table:

```bash
magents-cli sessions --json |
  jq -r '.[] | select(.title|test("2430|2449")) | "\(.title) \(.state) attn=\(.requiresAttention)"'
```

Rows carry `id`, `projectId`, `groupId`, `provider`, `externalId`, `title`,
`requiresAttention`, `model`, `variant`, `pid`, `pidStartedAt`, `state`. `state`
is `never-started`, `running`, or `stopped`; a session `new` just opened comes up
`running` with `requiresAttention: true`.

## What the CLI cannot do

- **No stop, kill, delete, attach, or tail verb.** It opens sessions and edits
  their metadata; ending one or reading its output happens in the TUI, which is
  the human's surface. Treat every `new` as permanent — there is no undo.
- **No wait or poll primitive.** Poll `sessions --json` yourself, on
  `requiresAttention` rather than `state`: `stopped` is one bucket for finished,
  crashed, and killed, and carries no exit code.
- **It cannot drive the agent after the prompt.** Built-in slash commands of the
  spawned agent (`/rename`, `/clear`) are reachable only from inside that
  session, by a human. A skill whose steps end in one — like `do` — prints the
  line for the user to paste; don't try to deliver it through `magents-cli`.

Opening a session in a **hibernating** group is fine: hibernation stops an agent
that is *moved* in, never one opened there.

## Common mistakes

| Symptom | Cause |
|---|---|
| terminal floods with escape codes | ran `magents` instead of `magents-cli` — `reset` to recover |
| `Unknown option '-p'` | `-p` outside `new`; `models` wants a positional |
| `no group named X in <project>` | groups are looked up, never created — `groups add` first |
| `not connected` | `magents-daemon` is down (the help's `bun run daemon` is the source-checkout form); confirm with `ss -xlp \| grep magents` |
| session opened under the wrong bucket | no `-g`, so the project's default group won |
| session opened against the wrong repo | no `--project`, so the cwd won — and an unregistered cwd is silently registered as a new project |
