# magents

**One terminal for all your coding agents.**

magents is a control plane for [Claude Code](https://github.com/anthropics/claude-code)
and [Codex](https://github.com/openai/codex) sessions. Start agents across all your
repositories from one roster, leave them working in the background, and find out
the moment one of them finishes or needs an answer — without a tab per agent and
without wandering back to check.

```
  MAGENTS   │ agent control plane                       ~/code/atlas-api
            │ 5 sessions · 2 projects     rename session · hibernate | ? keys
──────────────────────────────────────────────────────────────────────────
 ⌕ search sessions, projects…  │
                               │
 ▾ magents                   3 │   ╭───────────────────────────────────╮
   ▾ Active                  2 │   │                                   │
     ▎ ◆ JIRA-1979 - address…  │   │   the selected agent's terminal,  │
     ▎ ◆ JIRA-1980 - fix tests │   │   live — type straight into it    │
   ▸ Done                    1 │   │                                   │
 ▾ atlas-api                 2 │   ╰───────────────────────────────────╯
   ▎ ◆ migrate the schema      │
   ▎ ◆ review the API surface  │
 / search  ↑↓ navigate  ⌃n spawn  ? keys  q quit
```

## Why

Running more than one coding agent gets messy fast. Each one lives in its own
terminal tab, tied to the window that started it. Close the window and the agent
dies with it. And an agent that has finished, or stopped to ask permission, looks
exactly like one still working until you go and look.

magents moves the agents out of your terminal tabs and into a small background
daemon. Every session — Claude or Codex, in any repository — sits in one roster,
keeps running when you quit the UI, and lights up when it wants you.

## Features

- **One roster, every agent.** Claude Code and Codex sessions across all your
  projects, side by side, searchable by name, project, provider or model.
- **Agents outlive the UI.** The daemon owns every agent's terminal. Quit the
  TUI, close the window, come back an hour later: the agent kept working, and
  attaching replays the screen it left.
- **It tells you when it needs you.** When an agent finishes a turn or asks for
  permission, its row pulses and the terminal bell rings once. This works through
  the providers' own hooks, so it fires even when nothing is on screen.
- **Groups you define.** Organise each project's sessions into your own buckets
  — `Active`, `waiting on CI`, a ticket number. Nothing moves a session on its
  own. A group can be set to *hibernate*: drop finished work in `Done` and its
  agent stops.
- **Hibernate and resume.** Stop an agent's process and keep its conversation;
  start it again later with one key.
- **A scriptable CLI.** Everything the TUI does, from a shell, with `--json`.
  Fan out one session per ticket in a `for` loop.
- **Your agents can drive it too.** The install teaches Claude Code and Codex a
  `magents` skill, so an agent can open and organise sessions of its own.
- **Skills one slash away.** Type `/` in the prompt box to pick from the
  project's skills — user, repository and plugin skills, for both providers.
- **Import what you started elsewhere.** Bring a session opened outside magents
  into the roster by its provider id.
- **Keyboard and mouse.** Every action has a key and a click. Selecting text
  copies it, over ssh too.

## How it works

```
  magents (TUI)        magents-cli
        │                   │
        └──── unix socket ──┘       ~/.magents/daemon.sock
                  │
          magents-daemon            systemd user service
           ├─ SQLite                projects, sessions, groups
           └─ one terminal per agent
                  │
          claude · codex            run in the project directory
```

The daemon is the only process that touches the database and the only one that
holds the agents' terminals. The TUI and the CLI are both clients of it, so a
session opened from the CLI shows up in the TUI within a couple of seconds.

Agents run directly in the project directory — no worktree, no extra sandbox — so
they pick up the project's `CLAUDE.md`, `AGENTS.md` and settings exactly as if you
had started them there yourself.

## Requirements

- **Linux with systemd**, for the background daemon (a *user* service — the
  agents run as you, never as root). WSL works when systemd is enabled.
- **[Bun](https://bun.sh) 1.3 or newer.** The installer fetches it if it is
  missing.
- **`claude` and/or `codex`** installed and logged in.
- A **truecolor terminal**.

## Install

```bash
git clone https://github.com/OWNER/magents.git
cd magents
./install.sh
```

The installer explains what it is about to do and asks before doing it. It:

1. builds three binaries — `magents` (the TUI), `magents-cli` and
   `magents-daemon` — and installs them into `/usr/local/bin`;
2. starts the daemon as a systemd user service, `magents-daemon.service`;
3. adds the `magents` skill to Claude Code and Codex;
4. adds the attention hook to `~/.codex/config.toml`, leaving your own settings
   and comments as they were, and offers to open Codex once so you can approve
   it.

```bash
./install.sh --yes                      # don't ask
MAGENTS_PREFIX=~/.local ./install.sh    # install somewhere that needs no sudo
```

To update, pull and run `./install.sh` again. **Updating stops every running
agent.** The sessions and their conversations are kept, and `⌃r` starts each one
again.

## Quick start

```bash
cd ~/code/atlas-api
magents
```

1. `⌃a` adds a project. The field starts on the current directory, so `⏎` is
   usually enough.
2. `⌃n` opens the prompt box. Pick the provider with `⌃p`, write the task, send
   it with `⌃s`.
3. `→` or `⏎` attaches to the session so you can type into it. `⌃⌥←` detaches.
4. Quit with `q`. The agents keep running. Open `magents` again and they are all
   still there.

## Keys

| key | does |
| --- | --- |
| `/` | search sessions, projects, providers, models |
| `↑` `↓` / `k` `j` | move through the roster |
| `⏎` `→` | attach to a session, or fold a group |
| `⌃⌥←` | detach; in the roster, narrow the sidebar |
| `⌃⌥→` | widen the sidebar |
| `⌃e` | hide or show the sidebar, attached too |
| `⌃a` | add a project |
| `⌃n` | spawn a session in the current project |
| `⌃i` | import a session by its provider's id |
| `⌃g` | add a group |
| `⇧↑` `⇧↓` | move a group up or down |
| `⌃b` | move a session to another group |
| `⌃t` | rename a session, edit a group |
| `⌃r` | start the selected session's agent |
| `⌃h` | hibernate it — stop the agent, keep the conversation |
| `⌃d` | remove what is selected |
| `?` | the full key list |
| `esc` | clear the search |
| `q` | quit — the agents keep running |

The footer always shows the keys that work right now.

## CLI

```bash
magents-cli projects                                   # registered projects
magents-cli sessions [--project <ref>]                 # sessions, and whether they are running
magents-cli new -p claude --prompt "..." [-n <name>]   # open a session
magents-cli rename <session> <name>
magents-cli groups add Done --hibernates               # a bucket that stops what lands in it
magents-cli move <session> Done
magents-cli attention <session> [--clear]              # light a row, or put it out
magents-cli models claude                              # what -m and --variant accept
magents-cli <command> --help
```

A session, project or group can be named by its title, its path, or the start of
its id. `--project` defaults to the current directory. Every command takes
`--json`.

One session per ticket:

```bash
for t in JIRA-1979 JIRA-1980; do
  magents-cli new -p claude -n "$t" -g Active --prompt "/do $t"
done
```

The CLI exits `0` on success, `2` for a command typed wrong, and `1` for a
command the daemon refused, so a script can tell its own mistakes from the
daemon's answers.

## Configuration

| | |
| --- | --- |
| `MAGENTS_HOME` | where magents keeps its state — default `~/.magents` |
| `MAGENTS_DB` | the database file — default `$MAGENTS_HOME/magents.db` |
| `MAGENTS_SOCKET` | the daemon's socket — default `$MAGENTS_HOME/daemon.sock` |
| `MAGENTS_HISTORY_BYTES` | scrollback kept per session — default 4 MB |
| `MAGENTS_PREFIX` | install prefix for `install.sh` — default `/usr/local` |

`magents --no-bell` turns off the terminal bell; `magents --no-pulse` stops the
wordmark animation.

If a row lights up when it should not, `touch ~/.magents/hooks.debug` and every
hook call is logged to `~/.magents/hooks.log` until you remove the file.

## Uninstall

```bash
./uninstall.sh
```

This removes what the installer added: the service, the binaries, the skill and
the Codex hook. `~/.magents` — your projects, sessions and groups — is left in
place, and a later install picks it up again. The conversations themselves
belong to Claude Code and Codex and are never touched.

## Limitations

- **Restarting the daemon stops every agent it is running.** The sessions and
  conversations survive and `⌃r` brings each one back, but work in progress is
  interrupted.
- **Scrollback lives in the daemon's memory.** If the daemon crashes, sessions
  come back without their on-screen history.
- **Linux only.** The daemon runs as a systemd user service, and the installer
  has no other way to start it yet.
- **Codex sessions rely on an undocumented file format.** Codex has no flag to
  choose a session's id, so magents writes the first line of Codex's session file
  itself
  ([openai/codex#7801](https://github.com/openai/codex/issues/7801)).

## Development

```bash
bun install
bun run daemon               # the backend, in one terminal
bun dev                      # the TUI, reloading on save
bun run cli -- sessions      # the CLI against the same daemon
bun run lint                 # biome
bun run db:generate          # new migration after a schema change
```

Only one daemon can use a database at a time. If magents is installed and its
service is running, give the development copy its own home:

```bash
MAGENTS_HOME=/tmp/magents-dev bun run daemon
MAGENTS_HOME=/tmp/magents-dev bun dev
```

Built with [OpenTUI](https://github.com/anomalyco/opentui), React,
[Effect](https://effect.website), Drizzle over `bun:sqlite`, and
[TanStack Query](https://tanstack.com/query).

The reasoning behind the design — what was measured, what was tried and
abandoned, and why each part works the way it does — is in
[docs/design-notes.md](docs/design-notes.md). Read the section that covers a part
before changing it.

## License

TBD
