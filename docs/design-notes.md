# magents — design notes

Why magents is built the way it is. The [README](../README.md) says what it
does and how to use it; this is the reasoning behind it, written down as the
decisions were made — what was measured, what was tried first and why it was
wrong, and what each choice costs. Read it before changing the part it covers.

Three pieces, joined along one seam: **projects**.

- **The daemon** (`daemon/`) owns the database, owns every agent's terminal, and
  listens on a unix socket in `~/.magents`.
- **The TUI** (`src/`) registers projects through it, opens sessions through it,
  and watches a running agent over the same socket.
- **The CLI** (`cli/`) does the same operations without a screen. Both front
  ends speak to the daemon through `client/`, which is the only module that
  knows the socket path and the routes.

## The daemon

The backend process, in `daemon/`. It owns the database — one writer, so nothing
has to arbitrate — and answers over a unix socket.

```bash
bun run daemon          # migrate, listen on ~/.magents/daemon.sock, stay up
bun run daemon:dev      # the same; it does not reload on save, see below
bun run db:generate     # regenerate migrations after editing the schema
bun run db:studio       # drizzle-kit studio against the same file
```

Drizzle ORM over `bun:sqlite`, with generated SQL migrations applied at boot,
wrapped in [Effect](https://effect.website) v3. `MAGENTS_DB` points it at
another file, `MAGENTS_SOCKET` at another socket, `MAGENTS_HOME` moves the whole
directory.

`daemon:dev` used to be `daemon` plus `--watch`, and that is exactly what it
cannot be now that the daemon holds every running agent's terminal. A reload is
a restart and a restart kills them, so saving a file would have ended whatever
was working at the time. The two scripts are the same command; the second one is
kept so nothing that already calls it breaks.

### The socket

A unix socket rather than a port: there is no port to collide with, no chance of
answering the network by accident, and the permissions on `~/.magents` are the
access control.

It is also what makes the process resident: a listening socket keeps the event
loop alive on its own, and before there was one the daemon opened the database,
printed, and exited, because a process with nothing listening has nothing to
stay up for.

The listener is no longer the *whole* of being alive, though. That was honest
while the daemon was a request handler and stopped being true the moment it took
the PTYs, because SIGTERM's default action ends the process where it stands and
releases nothing — the children get hung up on by the kernel rather than shut
down, and being hung up on is not a shutdown. So `daemon/index.ts` waits to be
told to stop and completes normally when it is, which is the only ending that
closes the scope and kills the children on purpose.

The stale socket file is removed on the way *in*, not on the way out. A daemon
killed with `SIGKILL` never runs its release, and the leftover file makes the
next start fail with `EADDRINUSE` on a socket nobody is listening to. Cleaning
up before binding is the only version that survives a crash.

### Routes

| route                             | does                                     |
| --------------------------------- | ---------------------------------------- |
| `GET /projects`                   | every registered project, oldest first   |
| `POST /projects`                  | `{"path": "..."}` → the project row      |
| `DELETE /projects/:id`            | forgets it, and its sessions with it     |
| `GET /sessions`                   | the sessions, `?project=` to narrow      |
| `POST /sessions`                  | opens one: the row, and the process      |
| `PATCH /sessions/:id`             | `title`, `requiresAttention`, `groupId`  |
| `POST /sessions/import`           | adopts a session started outside magents |
| `DELETE /sessions/:id`            | kills it, then forgets it                |
| `POST /sessions/:id/terminal`     | runs the agent again                     |
| `DELETE /sessions/:id/terminal`   | stops it; the row and its output stay    |
| `GET /sessions/:id/attach`        | the one route that answers with a socket |
| `GET /groups`                     | the buckets, `?project=` to narrow       |
| `POST /groups`                    | makes one, at the end of the project's   |
| `PATCH /groups/:id`               | title, default, hibernates, collapsed, after |
| `DELETE /groups/:id`              | drops it; its sessions stay              |
| `GET /providers/:id/models`       | what that provider can be pointed at     |
| `GET /health`                     | that something is listening              |

`POST` is idempotent: registering a path that is already registered returns the
row that was already there. The caller asked for the project to exist, and
afterwards it does, which is the same answer either way.

The name is never sent. The daemon takes it from the folder, so there is nothing
a caller can pass that disagrees with the path.

`DELETE` takes the sessions with it — `sessions.project_id` is
`onDelete: "cascade"`, which only fires because the connection turns foreign
keys on. Measured on a throwaway database: three sessions across two projects,
remove one project, one session left and it is the other project's. A miss is a
404 rather than a quiet 204: the only caller is a screen deleting something it
just listed, so "that project is not here" means the list it is showing is out
of date, and saying so is more use than pretending it worked.

Paths are checked before they are stored: `~` is expanded, the path is resolved
to an absolute one, and anything that is not a directory on disk is refused with
a sentence rather than stored. A project row is a claim that a repository is
there; without the check the daemon would happily keep a typo, and the failure
would surface later, far from the mistake.

Each route maps its own failures to status codes in one place, so the client
gets a sentence it can put on the screen instead of a stack trace:

```
400  body is not JSON · expected a string `path` · no such directory: /nope
500  createProject failed
```

`Effect.runtime` is what lets a Bun request handler — a plain async function,
called from outside any Effect — run an effect that needs the database. The
alternative is a second connection, and two writers on one SQLite file is
exactly what the daemon exists to avoid.

### The terminals

The daemon owns every agent's process, not just its row. A PTY child dies when
the last master fd closes — measured, and from the child's side
indistinguishable from being killed outright — and that fd used to live in the
TUI, so quitting the TUI hung up every agent in it. It lives here now: a client
can quit, be killed, or stay away for an hour, and the agent carries on, because
nothing it depends on went anywhere.

Because nobody has to be watching, the bytes have to be kept. Each session holds
a ring of its own recent output — four megabytes, `MAGENTS_HISTORY_BYTES` moves
it — and attaching replays that before the live stream starts, which is what
makes coming back to a session show the screen you left rather than an empty
one.

A process ending writes one last line into that ring — `[exited with 3]`,
`[killed by SIGSEGV]` — because an empty rectangle is indistinguishable from one
still loading, and that line is the last thing a background session leaves
behind for whoever attaches an hour later.

**Except when the ending was asked for.** Hibernating a session (`⌃h`) empties
the ring instead of adding to it, and the two cases are told apart by a flag
`kill` sets before it signals — from the exit hook a SIGTERM we sent and a
SIGTERM from anywhere else are identical. An agent that fell over leaves its
last words because they are the evidence; one that was put to sleep leaves
nothing, because there is nothing to explain and `[killed by SIGTERM]` is our
own signal reported back to the person who asked us to send it. The state is
`stopped` rather than `exited`, which is what that state exists for, and it is
what lets a blank pane say which kind of blank it is.

Clearing the ring answers whoever attaches next. Whoever is attached *now* holds
the screen in an emulator on their side of the socket, and a new stream id does
not clear it — a client appends a stream it has not seen, which is right for a
restart, where the new program's output belongs under what it replaced. So the
clear travels as output: `ESC c` then `ESC [3J`, which is a thing terminals
already say to each other, and means no new frame type and no new branch in the
client. `RIS` rather than `ESC [2J` because both blank the visible screen
(measured against the renderable, with a control that showed the history still
there) but a process that is gone should leave none of its modes behind either.

`GET /sessions/:id/attach` is the one route that answers with a socket, dialled
as `ws+unix://<socket>:/sessions/<id>/attach` on the socket that already exists.
Keystrokes and sizes go up it, output comes down it, and a client that
reconnects sends back the stream id and byte offset it had, so the daemon can
resume from there instead of replaying the whole session on top of what is
already drawn.

`sessions.pid` is the only column here that is not a fact that stays true. The
registry in memory is the authority on what is running; the column is a
projection of it, on disk purely so the *next* daemon can find what a SIGKILLed
one left behind. It is cleared unconditionally at boot, which is what buys it a
meaning worth reading: a non-null pid says the daemon running right now spawned
this and has not seen it end.

Attaching to a session that has stopped does not restart it. Restarting is
`POST /sessions/:id/terminal`, asked for out loud, because once the daemon keeps
a crashed agent's last words, relaunching on the first glance destroys the thing
you came back to read.

**Restarting the daemon kills every agent it is running.** It used to be a
stateless request handler that could be bounced at any time; it is now the
process holding the work. Nothing in the code enforces that — there is no
confirmation, no refusal while sessions are live, and no way to hand the
children to a successor. Knowing it is the only thing standing between a habit
and a lost afternoon, which is why it is written down here. What *is* enforced
is that there is only one of it: a boot refuses when another daemon already
holds the database, because the second one's boot sweep would read the first
one's live children as orphans of a crash and signal every agent on the machine.

Two things this still does not do. **History lives only in daemon memory**, so a
daemon crash loses every session's scrollback while the rows survive: the roster
comes back with its sessions and the panes replay nothing. And **truncated
replay is approximate, with nothing restoring what was cut.** The ring holds a
few megabytes per session; past that the head is evicted whole chunks at a time
and the replay is marked `truncated` so the pane can say so. Nothing
reconstructs the terminal state as of the cut — a replay can begin in the middle
of an escape sequence or under an SGR run that was set above it, and render
wrong. A classifier that tracked modes and cut only at a sequence boundary is
the fix and is not written; the flag on the wire is there so the wrongness is at
least visible.

### Services

**One file, one thing, one named export.** `services/` holds an operation per
file; `lib/` holds the pure helpers those operations lean on; `errors/` holds
the failures. Nothing exports a grab bag.

Every operation returns `Effect<A, DatabaseError, Database>` — what it produces,
how it fails, and what it needs, in the type. Three things fall out of that:

- **Failures are values.** A foreign-key violation arrives as a typed
  `DatabaseError` tagged with the operation that caused it, not as an exception
  thrown past whoever was supposed to handle it. A bare SQLite message says
  `FOREIGN KEY constraint failed`; it never says what was being attempted.
- **A miss is not a failure.** `findProjectByPath` returns `Option`, so the
  caller has to say what it does about an absent project instead of forgetting
  that `undefined` was possible.
- **The connection closes itself.** `Database` is a scoped service:
  `Database.Default` opens the database on the way in and closes it when the
  program ends — including when it ends badly. Verified against a program that
  fails mid-flight.

**It is resident, and that now matters.** The listener is what keeps the event
loop alive; holding a process up with a timer instead would have been a process
holding a file handle. Since the terminals moved here, the same residency is
also what every running agent depends on.

### Schema

```
projects              sessions
  id    uuidv7          id          uuidv7
  name  folder          project_id  → projects.id, on delete cascade
  path  unique          provider    'claude' | 'codex'
```

Ids are **UUIDv7** — time-ordered, so rows sort by creation and the primary-key
index appends instead of scattering writes across the B-tree the way a random v4
does. `Bun.randomUUIDv7()` is native, so nothing is installed for it.

Three things the schema will not let you get wrong:

- **`name` is never an argument.** `createProject(db, path)` derives it from the
  folder, the same rule the roster follows. A name you can pass is a name that
  can disagree with the directory it claims to be.
- **`PRAGMA foreign_keys = ON`, every connection.** SQLite leaves foreign keys
  *off* by default, per connection. Without it `sessions.project_id` is
  decoration: unknown parents insert happily and the cascade never fires.
- **`provider` has a CHECK constraint.** Drizzle's `{ enum: [...] }` is a
  TypeScript claim, not a stored one, and the daemon will take writes from
  outside TypeScript.

`createProject` is idempotent — registering a known path returns the existing
row, because callers register on every startup.

Relations live in their own files, which leaves the imports acyclic: the tables
know nothing about each other beyond the foreign key, which points one way, and
the relation files are the only place that reaches for both. `schemas` carries
those relations alongside the tables, which is what makes
`db.query.projects.findMany({ with: { sessions: true } })` resolve.

## The CLI

A second front end onto the same daemon, in `cli/`. `bun run cli -- <command>`,
or `bun link` and then `magents`.

```bash
magents projects                                  # what is registered
magents sessions [--project <ref>]                # what is open, and where its process is
magents new -p claude --prompt "..." [-n name]    # open one
magents rename <session> <name>                   # rename one
magents attention <session> [--clear]             # light its row, or put it out
magents hooks <provider>                          # how that provider is told about the hook
magents models claude                             # what -m and --variant can be
magents --help                                    # this, per command too
```

Every command goes through `client/`, the same module the TUI's queries call.
There is no second copy of the socket path, no second list of routes, and a
route that changes shape breaks both front ends at compile time rather than
leaving one of them quietly wrong. Nothing in `cli/` reads the database: the
daemon holds the only writer, and a CLI that opened the file beside it would be
the second one.

**References, not ids.** `--project` and `rename`'s first argument take a path,
a name, or the front of an id, because nobody has a UUID to hand — what they
have is the folder they are standing in and the name they can see in the
roster. `--project` left out means the current directory. A reference that
matches twice is refused rather than resolved: taking the first hit would make
`magents rename api "..."` rename a different session depending on what else
happens to be open.

The short id in a listing is thirteen characters, and the number is measured. A
UUIDv7 opens with a 48-bit millisecond, so the first *eight* are its top 32 bits
and move once every 65 seconds — every row opened in the same minute shares
them, which made the first cut of that column decorative. Thirteen is the whole
timestamp.

**The provider is required**, which is the one place this differs from the spawn
panel. The panel opens on codex and says so on the screen, beside a key that
changes it; the default is visible and revisable before anything is sent. A CLI
has no screen, so a default there would be an invisible choice made on
somebody's behalf, found out about when an agent you did not mean to start is
already running.

`--prompt -` reads stdin, which is what `--name` is for: a prompt piped in from
a file has a first line that makes a poor title.

### How the TUI finds out

It is not told. Nothing crosses from the CLI process to the TUI process, because
there is nothing the CLI knows that the daemon does not — and `use-daemon-heartbeat.ts`
already refetches the session list every beat and a half.

The projects list joined it when the CLI landed. That is the same doctrine
failing the same way twice: the rule was "the data changes when this process
changes it", the agents moving made it untrue of sessions, and a second client
makes it untrue of projects — `magents new` in an unregistered folder registers
one from another terminal. It is not a cosmetic gap. The roster draws sessions
*under* their project and iterates only the projects it knows, so a session
whose project arrived after the last fetch is not a row that looks stale, it is
a row that is not drawn. Measured, with the refetch removed and put back: a
session opened from the CLI in a fresh folder appears in the roster within two
beats with it, and never without it.

A push channel would make that instant and is the obvious next step if the
latency ever matters. It is not built, because a beat and a half on a change
somebody made in another window is not a wait anybody notices.

## Install

`./install.sh` builds three standalone binaries, puts them on PATH, and runs the
daemon under systemd. The same script installs and updates — an update is an
install over the top of the last one.

```bash
./install.sh                          # asks first
./install.sh --yes                    # does not
MAGENTS_PREFIX=~/.local ./install.sh  # somewhere that needs no sudo
```

| binary           | is                                      |
| ---------------- | --------------------------------------- |
| `magents`        | the TUI                                 |
| `magents-cli`    | the command line                        |
| `magents-daemon` | the backend, started by systemd         |

**A user service, not a system one.** The daemon spawns claude and codex as you,
reads the config in your home directory, and owns `~/.magents`. As a system
service every agent would be root's.

**It stops every running agent**, which is what the confirmation warns about.
The sessions themselves survive — they are rows, and the conversations belong to
the providers — so after the update `⌃r` puts a process back on one. Verified
end to end: an agent running under the service, an update over the top, the row
still there with no pid, and `⌃r` bringing back a live process on it.

The build happens *before* anything is stopped, which is the one place the
script departs from the obvious order. Stopping first would mean a compile error
costs you every running agent and leaves you on the version you already had.

Two things it works out rather than assumes:

- **Where the migrations went.** `bun build --compile` embeds the JavaScript and
  nothing else, so `import.meta.dir` is `/$bunfs/root` in the installed daemon
  and the SQL it migrates from is not in there. `migrations-dir.ts` looks beside
  the executable — `process.execPath` is exact inside a compiled binary and
  follows the file if it is moved — so `<prefix>/bin/magents-daemon` finds
  `<prefix>/share/magents/migrations` with nothing configured.
- **What PATH the daemon gets.** A systemd user service inherits nothing from
  your shell, so a daemon on the default PATH cannot find a provider installed
  by a version manager, and the failure shows up as a session that spawns and
  dies. Your PATH is baked into the unit — but resolved first, because version
  managers hand out per-shell directories that outlive nothing: on this machine
  `claude` sits under `/run/user/1000/fnm_multishells/<pid>_<stamp>/bin`, and
  what lands in the unit is what that points at. Upgrading the runtime your
  providers were installed under means running the script again.

## Attention

A session is only interesting at the moments nobody is looking at it. An agent
working is not news; an agent that has finished, or that has stopped to ask
permission, is — and if you are watching a different session at the time,
nothing changes on screen and you find out by wandering back. The same goes for
a session opened from the CLI in another terminal: it simply appears in the
roster with nothing to say it is new.

So `sessions.requires_attention` is a column, and the row it lights pulses —
the accent washed over whatever is underneath, with the *alpha* ramping rather
than the colour switching. Blinking reads as a fault; a ramp reads as a notice,
and is bearable for as long as this may be on screen, which is until somebody
comes back.

**Stored, not held in a screen.** Two TUIs on one daemon have to agree about
which rows are lit, and a flag in one of them is a flag the other is wrong
about. The interesting case is also precisely the one where there was no screen
to hold it: a session that finished while nothing was watching.

Three things set it, and one clears it:

| when | who |
| --- | --- |
| a session is minted — opened, or imported | the daemon, on insert |
| the agent finishes a turn | the provider's `Stop` hook — both providers |
| the agent stops to ask permission | the provider's `PermissionRequest` hook — both providers |
| the agent stops to ask anything else | claude's `Notification` hook; codex has no event for it |
| — but never one of its subagents | see *Only the session, not its workers* |
| the cursor rests on the row | the client, after a third of a second |

What the hooks run is our own CLI: `magents attention --hook`. They get there
by different routes — claude's on the command line when the daemon spawns it,
codex's from `~/.codex/config.toml`, for the reason in *Codex takes it from its
config* below — and the command is the same either way.

**Which** session is not in the command. It travels in the environment as
`MAGENTS_SESSION`, set on the PTY child, and reaches the hook because a hook is
a subprocess of the agent (measured, along with the shell it runs under:
`/bin/sh`). That keeps the command a constant instead of an id threaded through
JSON and then through an argv, which matters more than it looks twice over:
codex records trust against the command string, so changing it asks every
machine to accept the hook again — and codex's hook, living in a config file, is
on *every* codex session on the machine rather than only ours. A session we
started carries the variable and a session somebody opened themselves does not,
so the same command tells the two apart without knowing anything about either.

`--hook` is the flag that says a provider is calling rather than a person, and
it changes three things. The command answers `{}` on stdout — valid JSON with
no fields, which is how both providers spell "no opinion" — because codex parses
a Stop hook's output and otherwise writes `hook returned invalid stop hook JSON
output` into the agent's own transcript after every turn. A session it does not
recognise, or none named at all, is ignored in silence rather than treated as an
error, which is the ordinary case for a hook that fires on every codex session
on the machine. And it never fails for any other reason either: a daemon that is
briefly not answering is a row that does not light up, which is a small thing,
while an agent printing an error under every turn it completes is not.

### Only the session, not its workers

A hook fired from inside a subagent is not the session asking for you. It used
to light the row anyway, so a claude run that fans out to a dozen workers lit it
a dozen times, for a session that had finished nothing.

`Stop` is main-thread only — `SubagentStop` is a separate event and we do not
register it — so the noise came in through `Notification`, which is not. The
field that settles it is on the payload every provider writes to the hook's
stdin, and the agent SDK's own types name it:

> **`agent_id?: string`** — Subagent identifier. Present only when the hook
> fires from within a subagent (e.g., a tool called by an AgentTool worker).
> Absent for the main thread, even in `--agent` sessions. Use this field (not
> `agent_type`) to distinguish subagent calls from main-thread calls.

`agent_type` is called out there as the wrong one, and it is worth knowing why
rather than just obeying: it is also set on the main thread of a session started
with `--agent`, so filtering on it would put the light out for anybody who runs
claude that way. Measured against a daemon that records what reaches it:

| payload | reaches the daemon |
| --- | --- |
| `Stop`, main thread | yes — the row lights |
| `Notification` with `agent_id` | **nothing at all** |
| `Stop` with only `agent_type` | yes — the row lights |

Codex sends no such field, which costs nothing: absent means main, and for
codex that is always the true answer.

Reading stdin at all is new, and it comes with a deadline. A hook that blocks is
an agent that blocks, so the read is raced against half a second — and a
terminal is never read from at all, because that is somebody trying the command
by hand and a terminal sends no EOF until they press `⌃d`. The timer is cleared
the moment the payload lands rather than left to expire: a pending timer keeps
the process alive, and without clearing it every hook took 530ms to exit after
having had its answer in one.

If a row still lights when it should not, `touch ~/.magents/hooks.debug` and
every payload is written to `~/.magents/hooks.log` until the switch is taken
away. A file rather than an environment variable on purpose — a hook is a
grandchild of a systemd service, so an env var means editing a unit and
restarting everything, by which point whatever you were chasing has gone.

### Clearing it

Clearing waits for the cursor to stop. Arrowing down a list runs through every
row on the way, and a sweep past a lit row used to put it out without anybody
having read anything — landing on a row and moving on is not looking at it.

### Claude takes them on the command line

Claude takes them as `--settings` with JSON inline. The objection to that flag
written next to `CLAUDE_CODE_DISABLE_AGENT_VIEW` — that it would replace
whatever settings the user passes claude themselves — turns out to be false for
hooks, and it was worth measuring rather than reasoning about. With a `Stop`
hook in the project's own `.claude/settings.json` and a different one passed on
the command line, both ran. It adds a hook rather than replacing a file. (The
env var stays right for `disableAgentView`: that one *is* a scalar, and a scalar
does get replaced.)

### Codex takes it from its config

Codex can take the hook on the command line — `-c hooks.Stop=[…]`, the same door
the reasoning effort goes through. This section said it could not, twice, both
times on the strength of documentation and both times wrongly, and the
correction is worth leaving visible along with the hook's own report from the
run that settled it:

```
EVENT Stop | MAGENTS_SESSION=[probe-0002] | stdin={"session_id":"01a0552d-…",
"turn_id":"…","hook_event_name":"Stop","model":"gpt-5.6-sol",…}
```

It shipped that way and it was **unstable**. The same session would report one
turn and stay dark on the next, with nothing different about either. An
attention light that is right most of the time is worse than none at all,
because a dark row stops meaning anything and you go back to checking by hand.

So the hook moved into `~/.codex/config.toml`, where it is not an override
riding on one invocation but simply what codex does:

```toml
[hooks]
Stop = [{ hooks = [{ type = "command", command = "…/magents-cli attention --hook" }] }]
PermissionRequest = [{ hooks = [{ type = "command", command = "…/magents-cli attention --hook" }] }]
```

Two events, and the second was added after the first had been in for a while,
because a codex row waiting on an approval stayed dark: `Stop` fires when the
turn ends, and a turn stopped on "may I run this outside the sandbox?" has not
ended. `PermissionRequest` fires the moment that prompt appears — watched, on
0.152.1 — and the `{}` our hook answers is "no decision", so the prompt goes on
to appear exactly as it would have. Claude gets the same event on the command
line beside `Notification`, which already covered the prompt but reported it
six seconds late; `PermissionRequest` reports it at once.

`install.sh` puts it there by calling `magents-cli hooks codex --write`. That
is a program rather than shell, and it moved out of `install.sh` once it became
clear what the job actually is: **the file belongs to somebody else.** It may
already have hooks in it, and it certainly has their comments and their
formatting. Reading it into an object and printing it back would produce a file
that works and that they did not write.

So it is a text edit, and TOML picks which one — these are measured, not
assumed:

| what is already in the file | what happens |
| --- | --- |
| no `hooks` at all | a `[hooks]` table is appended |
| `[hooks]`, no `Stop` | a `[[hooks.Stop]]` section is appended |
| `Stop` written as `[[hooks.Stop]]` | another `[[hooks.Stop]]` is appended |
| `Stop = [ … ]` written inline | our entry goes into their array |

The same four, per event — `PermissionRequest` is placed by the same rules —
and everything that is appended lands in one marked block, so a file that had
our `Stop` from before gets `PermissionRequest` beside it on the next install.

Only the last one is an edit inside their lines, and it is unavoidable: TOML
lets an array-of-tables section start or extend an array anywhere in the file,
but a `Stop` written as an inline array cannot be extended by a later section —
*cannot mutate immutable namespace* — so there is nowhere else to put it.

What makes editing on a pattern match safe is that **nothing is trusted
afterwards**. Every candidate is parsed back and compared against the original:
each event's array must have grown by exactly one, every entry that was in it
must still be there byte for byte, the new one must run this install's command,
and everything outside those arrays must be unchanged. A candidate that fails any
of it is dropped unwritten and you get the entry to paste yourself. The edit is
allowed to be clever because the check is not.

It also declines rather than guesses when:

- **an older magents hook is in the array** — a different path from a previous
  install. Adding ours beside it would leave codex running a command that may
  not exist any more, after every turn.
- **its own opening marker has no closing one** — dropping from there to the end
  of the file is right while our block is last and silently destructive the
  moment anything was added after it, and nothing in the file tells the two
  apart.
- **the config does not parse before we touch it** — that is true without us in
  it, so it is not ours to fix.

The write itself is a rename over the top, staged beside the target so the two
are on one filesystem: the config is either version and never half of one.

The cost of a config-file hook is that it fires for every codex session on the
machine, magents' or not. That is what `MAGENTS_SESSION` handles, and it is why
`attention --hook` treats an unknown session as nothing to do.

**It still asks.** A hook codex has not been told to trust is skipped in
silence — no error, no warning, exit zero — wherever it was declared. The way it
is told is by asking you, and accepting persists: measured, by accepting once
and then watching the same hook fire in a later run with nothing bypassed. So
`install.sh` ends by offering to open codex once, carrying nothing special,
because the hook is already in the config. Once per machine, and again if the
command changes.

`--dangerously-bypass-hook-trust` lived here for a day and is gone. It does not
mean "trust this hook", it means "check none of them", and it was answering a
question codex already answers better.

### Uninstall

`./uninstall.sh` takes the same things off that `install.sh` put on — the
service, the three binaries, the migrations, and the block in codex's config —
and nothing else. `~/.magents` stays, on purpose: it is the one part of an
install that cannot be rebuilt — the sessions, projects, groups and the TUI's
preferences — and a later `install.sh` over it picks all of that up again.
Removing it is a decision about data rather than about a program, so the
script does not offer to; it is one `rm` away for whoever has decided.

The conversations are never touched either; they are claude's and codex's,
under their own homes.

## Requirements

- **Bun >= 1.3** — `bun:sqlite` and `Bun.randomUUIDv7()` are used directly.
  `install.sh` fetches it from bun.com when it is not on PATH; it is needed to
  build, and the binaries it builds carry their own runtime
- A truecolor terminal

## Run

```bash
bun install
bun run daemon   # in one terminal — the TUI runs without it, with no projects
bun start        # in another; or: bun dev, for reload on save
bun run cli -- sessions        # the same daemon, without a screen
```

| key      | action                                                        |
| -------- | ------------------------------------------------------------- |
| `/`      | focus the search bar                                          |
| `↑` `↓`  | move through the roster (`k` / `j`; arrows work while typing)  |
| `⌃a`     | add a project                                                 |
| `⌃i`     | import a session by the id its provider gave it               |
| `⌃n`     | spawn an agent in the project you are in                      |
| `⌃⌥←` `⌃⌥→` | narrow and widen the sidebar; attached, `⌃⌥←` detaches    |
| `⌃e`     | hide or show the sidebar — attached too                       |
| `⏎` `→`  | type into the selected session                                |
| `⌃r`     | start the selected session's agent                            |
| `⌃h`     | hibernate it — stop the agent, keep everything else           |
| `⌃t`     | rename a session, edit a group                                |
| `⌃d`     | remove what is selected                                       |
| `?`      | the key list, in a modal                                      |
| `esc`    | leave the search, then clear it — never quits                 |
| `q`      | quit                                                          |

`⌃⌥←` detaches and `→` or `⏎` attaches, which is claude's own agent view read
with two modifiers: it backgrounds a session on `←` and returns on `→`. The bare
`←` was the detach key for a day and went back to the agent, whose input cursor
it is; `⌃←` was the key after that and went back too, because it is the word
jump inside claude and codex and gets used all the time. Nothing in either agent
answers `⌃⌥←`. In the roster the same chord narrows the sidebar. `⌃o`, which
detached for a while, still does and is not advertised.

`⌃e` gives the agent's pane every column, and it works attached because that is
when the room is wanted — which costs the agent `⌃e` as end-of-line; `End`
still does it. With the sidebar gone, the roster's pulse goes with it, so the
footer takes over: it breathes in the same colour and says how many sessions are
waiting, not counting the one already on screen.

`⌃r` and `⌃h` are a pair and the roster only ever offers one of them: the
footer reads the session's state, and no state is both. Hibernating stops the
process and keeps the row, the conversation and the screen the agent left
behind — `⌃r` puts an agent back on it. Removing a session, `⌃d`, is the other
thing entirely.

Two of those chords are ASCII control characters a terminal already had a name
for: `⌃i` is tab and `⌃h` is backspace, byte for byte. With kitty keyboard
disambiguation they arrive as chords and are told apart; without it they arrive
as the bare key, which is what `Binding.fallback` is for. Neither steals
anything — the search and a focused terminal are answered before the roster's
table is read, so backspace still deletes a character in both.

Flags:

```bash
bun start --no-pulse        # pin the wordmark to its resting state
bun start --no-bell         # no terminal bell when a session starts wanting you
```

When a session goes from quiet to wanting somebody — an agent finished a turn
or asked something — the TUI rings the terminal's bell (BEL, `\x07`) once, so
it reaches you in another window. Not for the sessions already lit when magents
starts, and not for one just spawned: a session is born lit, and a bell for
the one you just asked for is noise. An agent's own bell does not get out — it
goes into the emulator that draws the pane — so this is the one there is.

### Nothing else writes to the terminal

A program that owns the screen cannot share it. The renderer writes frames to
stdout and keeps a model of what every cell holds; anything else that writes to
the terminal lands wherever the cursor happens to be, in cells the renderer
believes it already knows, and stays there until something redraws over them.

That is not hypothetical and it is not ours. `libopentui.so` — the native
emulator, written in Zig — logs at *info* level straight to fd 2:

```
info(page_list): adjusting page capacity=.{ .cols = 157, .rows = 296,
.styles = 128, .hyperlink_bytes = 384, .grapheme_bytes = 8192, ... }
```

It fires when a page grows to hold more distinct styles, hyperlinks or
graphemes, which is what a heavily coloured agent redrawing its screen does —
measured at 209 lines from one burst of styled output. On screen it arrives as a
sentence across row three or four of the whole terminal, outside every box, half
of it wiped by the next frame that covers those cells.

Zig's log level is fixed at compile time and the library exposes no switch, so
`src/lib/quiet-stderr.ts` takes the file descriptor instead: `dup2` through
libc, pointing fd 2 at `~/.magents/tui.log` before the renderer exists. It has
to be the descriptor and not `process.stderr` — the library writes to fd 2
directly, so nothing in JavaScript is in the path. The original is kept and
given back on the way out, and on a non-zero exit one line names the file, so a
crash whose trace went there is not a crash with no message.

If no libc opens, nothing happens and the log lines come back. They are ugly,
not fatal.

## The keyboard, in one table

`constants/bindings.ts` holds the roster's bindings as rows:

```ts
{ keys: ["up", "k"], label: "↑ k", description: "move up the roster",
  run: () => useAppStore.getState().moveCursor(-1) }
```

`keys` is plural because several keys can mean the same thing. Every row has a
`run`: the table is the keyboard, and nothing else.

A row with `ctrl` is a **chord**, and the screen answers it before it asks who
has the keyboard. That is the whole point of holding control — the key is safe
to press while typing, so `⌃a` opens the add-project form from the search as
readily as from the roster. A modal is the exception: it is a question on the
screen, and spawning another one over it is not an answer to it. `ctrl-c` stays
out of the table, because it has to work even from inside a modal.

The mouse used to sit in here as a row with no keys and no `run`, listed beside
the shortcuts as if it were one more thing to memorise. It is a sentence at the
foot of the key list now — *all of this works with the mouse too* — because the
mouse does not have bindings, it works on whatever it lands on.

**A row cannot lie.** The sentence in the key list and the behaviour it
describes are the same row; they used to be two files that could drift. The
screen's roster branch is now the whole lookup:

```ts
bindings.find((binding) => binding.keys.includes(key.name))?.run(renderer)
```

The search and a modal answer for their own keys before this is reached, which
is why `esc` in the table is the roster's escape and not the search's.

**`esc` never leaves the application** — `q` and ctrl-c do. It is the key you hit
to back out of something, and backing out of nothing is nothing. Its `run` is
guarded rather than unconditional, because `clearSearch` also sends the cursor
home and that is wrong when there was no search to clear.

## Roster and search

The sidebar is search on top, roster under it. The roster is grouped by project,
in the order `projects` is declared in `src/lib/agents.ts`, with user-level
agents last. Empty groups are dropped, so a search collapses the sidebar to the
projects that actually hit.

**A group is named by its folder, and that name is not stored.** `Project` holds
only a path; `folderOf()` takes the last segment. A stored name is one more
thing that can disagree with the path it sits on — the same reason `scope` is
derived from whether an agent has a project at all. The full path is not in the
sidebar: it sits top right, next to the wordmark, and follows the selection
(`~/.magents/agents` when a user-level agent is selected).

The search bar is one field over everything: name, description, provider, model,
tools, folder and full path. Terms are ANDed, so `codex atlas` means both, in any
field, in any order. It composes with the `p` filter rather than replacing it.

Two things it has to get right:

- **The cursor indexes the grouped paint order,** not the raw filtered list.
  `buildGroups` produces the order and `flatten` produces the list the cursor
  walks, so `moveCursor` counts through the same path the roster paints.
- **Projects are rows too.** `flatten` returns a `Row`, not an `Agent`: a
  registered group contributes its own heading first, then its agents. Anything
  said *about* a project is said on that row, and removing one is the first
  thing that needed to be. A seeded group's heading stays a label — there is
  nothing behind it to select.
- **Focus splits the keyboard.** With the search bar focused every printable key
  belongs to it — the shortcuts would otherwise eat the letters being typed. Only
  `↑`/`↓`, `enter` and `esc` stay global while typing.

## Mouse

The TUI is usable either way, not keyboard-first with a mouse afterthought.
`useMouse` is set explicitly at `createCliRenderer` — the roster rows, the search
field, the hint and the modal are all clickable, and every one of them is dead
without it.

| pointer            | does                                          |
| ------------------ | --------------------------------------------- |
| click a roster row | selects it, and takes the keyboard back        |
| wheel over roster  | scrolls it                                     |
| click the search   | focuses it                                     |
| click `? keys`     | opens the key list; clicking it again closes   |
| click `+ add project` | the same form `⌃a` opens                   |
| click a peek row   | puts that directory in the field              |
| click a project    | selects it                                    |
| click an action in the header | what it says — see below           |
| click `+ spawn agent` | the prompt box for that project            |
| click the status dot | retries the connection                      |
| select any text    | copies it — see *Copying*                      |
| click outside      | closes the modal                               |
| click `esc close`  | the panel's own way out, on its title row      |

The roster is a viewport and follows the cursor: keys move the selection and
the list scrolls to keep it on screen, the wheel scrolls the list and leaves
the selection alone. There is no scrollbar — the sidebar is narrow and a track
would cost every title a column — and the wheel used to move the selection
instead, back when the list was clipped rather than scrolled and a row below
the fold could be selected and never seen.

The modal panel stops mouse-down from propagating. Without that, reaching for
something inside the dialog bubbles to the backdrop and closes it.

**Labels and buttons carry `selectable={false}`.** OpenTUI starts a text
selection on mouse-down over any text renderable, so clicking a roster row also
highlighted it — a click meant as a button press left a smear behind. There is
no global switch to turn that off: `_defaultOptions` is an instance field, so
the library default cannot be flipped from the outside, and every text element
has to say so itself. The search input is the deliberate exception — selecting
inside a text field is what a text field is for.

## Copying

**Selecting is copying.** Let go of the mouse and whatever is highlighted is on
the clipboard — the same gesture claude code taught, no chord after it. The
renderer announces a finished selection exactly once, on the mouse-up, so it is
one copy per drag. A bare click copies nothing — and that needed a real guard,
not just an empty-string check: plain text answers a zero-width selection with
nothing, but the terminal pane answers it with the character under the pointer,
so clicking a pane to focus it was putting one letter on the clipboard.
Anchor equals focus means nothing was swept, and nothing is copied. The
highlight is handled one layer down, where it has to be: the renderer opens a
selection on the mouse-*down*, so a click painted that one character for as
long as the button was held, and clearing it on the mouse-up only shortened
the flash. The pane's renderable hands a zero-width selection on as "no
selection" and paints nothing until the pointer has moved past the cell —
measured with the button held: no highlight; dragged: highlight; released:
copied; a click after a drag: the old highlight gone, because the new
zero-width selection replaced it. The footer
says *✓ copied* for a moment, where the eye already is when a mouse gesture
ends.

The copy travels as OSC 52 — the escape sequence a program uses to hand text to
the terminal it is drawn in. That choice is what makes it work everywhere the
agents themselves work: no `clip.exe`-versus-`wl-copy` guessing about what is
on the other side of the PTY, and over ssh the text lands on the machine you
are sitting at, not the one the daemon runs on.

**The agent's own copy works too.** claude's copy-on-select used to say
"copied" inside a pane and be wrong: it emits OSC 52 at whatever terminal it
believes it is in, which is our emulator, which parsed the sequence and reached
no clipboard. `src/lib/osc52.ts` watches the byte stream on its way into the
emulator — a stateful scanner, because an escape sequence does not respect
socket-frame boundaries — decodes the payload and forwards it through the same
door our own selections use. Only for the pane that is on screen: a background
session is still a program that can emit anything it likes, and that must not
include rewriting your clipboard from a pane nobody is looking at. Replayed
history is excluded for the same reason the replay disconnects the input path:
a copy from minutes ago re-run on attach is not something anybody asked to
have on their clipboard now. Oversized sequences are dropped whole rather than
truncated — a truncated copy is a corrupted one.

**An unstyled cursor is a bar, not a block.** Outside magents, claude's input
shows the thin `|` of the terminal's own default cursor — claude never sends
DECSCUSR, it inherits. Inside, the emulator resolves "never asked" to `block`,
and the pane relays that to the real cursor, so the same claude grew a filled
rectangle. The emulator's answer cannot tell "never asked" from "asked for a
block" — both come back `block` — so `src/lib/decscusr.ts` watches the byte
stream for DECSCUSR itself: until the program inside chooses any shape, the
pane's cursor is a blinking bar; the moment it chooses — vim asking for its
block included — the choice is relayed untouched. Measured through the real
cursor state: unstyled → `line`, blinking; after `CSI 2 SP q` → `block`,
steady.

## Projects

`⌃a`, or the `+ add project` row at the bottom of the sidebar, opens a form with
one field, pre-filled with the working directory — you run magents from the repo
you are working in, so enter is usually the whole interaction.

Under the field, `FilePeek` lists what the path could mean: the directories
inside it, or the siblings that start with what has been typed, the way a shell
completes. A path field with nothing under it asks you to remember your own
filesystem and spells the mistake out only after you commit; this answers while
the question is still being asked.

Entries that hold a `.git` say `git` in a column of their own. You are picking a
repository, so which of these is one is the thing worth marking.

### Groups

A project can hold buckets, and you name them. Claude's agent view ships fixed
ones — *Ready to Review*, *Working*, *Completed* — which describe the lifecycle
somebody at Anthropic had in mind; a group here describes the one you have.
`Active`, `JIRA-1978`, `waiting on CI`, `stale` are all equally sensible, and none
of them is a state the daemon could have inferred. So **nothing ever moves a
session between groups on its own**: a group means whatever the person who typed
the name meant, and the only thing that can be wrong about it is something else
deciding when it changes.

```
 ▾ my-ai-project                          4
   ▾ Active                               2      ← arrow in the accent
     ▎ ◆ JIRA-1979 - address review
     ▎ ◆ JIRA-1980 - fix tests
   ▸ Backlog                              1      ← arrow in violet
   ▾ Empty                                0
 ▎ ◆ loose one
```

**The fold arrow is the mark.** It is drawn in the accent on the project's
**default** — where new sessions are born — and in violet on every other bucket.
That fact used to have a glyph of its own, `▰` beside `▾`, and two columns of a
twenty-six column row is a lot to spend on one bit: a colour on a glyph that has
to be there anyway costs nothing and is read faster than a second shape. Which
is also why the arrow no longer brightens under the cursor, on a project row
either — the selected row is already a lighter background with its title in
bold, and an accent arrow that meant "selected" here and "default" one line down
would mean nothing anywhere.

At most one default per project, held by a partial unique index rather than by
whoever is writing: `create unique index … on groups(project_id) where
is_default = 1`. Setting one clears the other in the same transaction, so
there is never a moment with two.

A project may have no default, and then new sessions hang directly off it — the
last row above. That is not a state to be migrated away: it is every session as
this shipped, and `--no-group` asks for it on purpose.

### Putting them in an order

The order is yours too. `⇧↑` and `⇧↓` move the selected group up and down its
project; nothing else moves, and a bucket at either end stays there rather than
wrapping round to the other. From the command line it is `magents groups move
Done --first`, or `--after Active`.

A new group is made at the **bottom**, which is the only place a bucket nobody
has placed yet honestly belongs, and the list no longer re-sorts itself when one
is renamed — an arrangement somebody made has to survive an edit to a title.

Underneath is a **fractional index** ([fraci](https://github.com/SegaraRai/fraci),
binary-encoded), and the choice is about what a move costs. An integer column
answers "put this one between those two" by renumbering every row after it — one
gesture, N writes, and two people dragging at once produce a list neither asked
for. A fractional key answers it with a value strictly *between* its neighbours,
so a move is one `UPDATE` of one row and nobody else's key changes. Two bytes
each, in a `blob`: SQLite compares blobs bytewise, which is the ordering fraci
assumes, where the string form would need the column and its index pinned to a
bytewise collation to mean the same thing.

The wire never carries the key. `Group` is the row minus its `position`, dropped
once at the service boundary — the list arrives sorted, and a couple of opaque
bytes crossing as `{"type":"Buffer","data":[128,0]}` is not something a client
could do anything with but sort by a second time.

So the request names a **neighbour**, not a slot: `PATCH /groups/:id` with
`{ after: <id> }`, or `{ after: null }` for the front — the one position with
nothing in front of it to be named by, the same reading `groupId: null` gets one
table over. An index is only true while nobody else is holding the list; a row
is still the row it was. Asking for an arrangement a group already has is
answered with the group and no write at all, which matters more than it sounds:
the key it would otherwise generate is a *finer* one, so a client reasserting an
order it is already holding would walk the column towards fraci's length ceiling
without moving anything.

Two keyboard notes, both measured rather than assumed. `⇧↑` arrives named `up`
with a modifier flag — the same name a bare arrow has — so shift is a field on
the binding rather than another entry in its key list, and it gets its own
lookup ahead of the general one; otherwise plain `↑` would move a group. And
`⌃k`/`⌃j` were the obvious pair and are not usable: `⌃j` is 0x0A, which a
terminal without kitty disambiguation reports under a name of its own — the same
trap `⌃m` fell into on the key below.

The upgrade backfills the keys in creation order, per project, which is exactly
the order the list had before it could be arranged. That migration is
hand-written: the one drizzle-kit generated was `ALTER TABLE groups ADD position
blob NOT NULL`, which SQLite refuses outright — a `NOT NULL` column added to an
existing table needs a default, empty table or not.

### A group can mean something

A bucket can be marked **`hibernates`**, and then moving a session into it stops
the agent. Make one called `Done`, drop finished work in it, and the processes
go away — you never told anything *when* a session was finished, you told it
what `Done` means to you.

This is the shape the whole feature is after, and it is worth naming: the
alternative is a tool that guesses. Fixed lanes have to infer when a session
moved between them, which means hooks, heuristics, and being wrong in ways you
cannot correct. Here the daemon infers nothing. You say where a session goes;
the group says what going there means. Both halves are yours.

Two rules keep it honest:

- **Moves only, never creation.** Opening a session into a group is somebody
  asking for work to *start*, so the rule does not fire — otherwise a
  hibernating group that also happened to be the default would kill every new
  session at birth.
- **Only on a real change of group.** A client re-asserting the group a session
  is already in is not asking for it to be stopped again.

*auto-hibernate* sits beside the group's count in the roster, italic and spelled
out where the two states of a bucket get a glyph. It is not a state of the
bucket — it is a rule about what arriving there does — and a one-letter mark for
a rule is something you have to have been told about before it tells you
anything. `⌃z` still toggles it in the new-group form. Unlike `default`, it
turns off as readily as on: "stop putting things to sleep here" means exactly
one thing, where "stop being the default" does not.

### Moving between them

`⌃b` on a session opens the list of its project's buckets, `no group` included,
starting on the one it is already in. A list rather than the spawn panel's
cycling chord: there the group is one of four decisions and a ring keeps the row
short; here it is the only question and eight buckets would be eight presses to
reach the last.

`b` is the second-choice letter and the reason is worth recording. `⌃m` is what
anybody would reach for, and `⌃m` is 0x0D — carriage return. On a terminal
without kitty disambiguation it arrives named `return`, which already types into
a session and folds a group. The `fallback` field solves that collision for `⌃i`
and `⌃h` because `tab` and `backspace` mean nothing else in the roster; `return`
means two things already.

A group that hibernates says so on its row in that list. It is the one option
with a consequence beyond where a row is drawn, and a list that let somebody
find that out afterwards would be hiding the only thing worth warning about.

`⌃g` makes a group, `⏎` or a click folds it, `⌃t` edits, `⌃d` removes.

**`⌃t` on a group is not a rename.** It opens the same three fields the form
that makes one has — the name, whether new sessions land here, whether what is
moved here goes to sleep — because they are the same three facts, and a panel
that could only rename would mean the other two decisions were final at the
moment the group was born, which is the moment somebody knows least about them.

The default is the one that behaves differently, and it behaves differently all
the way down: the daemon refuses `default: false` rather than ignoring it. A
project either has a home for new sessions or it has not, so there is no such
thing as no longer being the default — only another group being it instead. So
the toggle is live on a group that is not the default and locked on the group
that is, and switching it on names the group it is taking it from, because
those are one act rather than two.

**The fold is stored.** It lived in the TUI's own store, and the comment there
argued it belonged there: a fold is a fact about *that* pane, where attention is
a fact about the session and so has to be shared. The reasoning was fine and the
premise was wrong. Two panes on one daemon are not two people reading over each
other's shoulders — they are one person, in two terminals, on one machine, and a
heading folded in one of them is something they decided about the *bucket*.
Coming back to the other window and finding it open again is the tool
forgetting. So `groups.collapsed` is a column, `PATCH /groups/:id` takes it, and
the heartbeat asks for the group list every beat and a half like it already
asks for the sessions.

It is sent as the state it should end in rather than as a toggle, which is what
makes two windows able to share it: two panes that both said "toggle" about a
heading they both saw open would leave it open, and neither of them asked for
that. And it is painted before the daemon answers — every other write here waits
for the round trip, which is right for a rename that can fail, but a fold is a
key somebody is holding down while they read, and a heading that turns over a
beat later reads as a key that missed. The only thing that puts it back is the
daemon refusing.

A search still overrules a fold — a match hidden inside something closed an hour
ago is a search that answered wrongly — and that half stays in the screen, where
it belongs: a question being asked in one window is not a reason to unfold
anything for anybody else. The fold comes back when the query clears.

**Removing a group does not remove its sessions.** `sessions.group_id` is `on
delete set null`, so they land back under the project, and the confirm panel
says so rather than warning: `⌃d` on a heading with a dozen conversations under
it looks exactly like `⌃d` on one of them, and somebody who believes it takes
the work will not press the key they meant to.

The indentation is one rule applied twice: a child's glyph sits under its
parent's first letter. A group heading spends two columns on its indent and two
on its fold arrow, so its mark lands on column four and its title on six; a
session indented four puts *its* mark on six, under the group's title — the same
way a loose session's mark sits under its project's name.

From the command line:

```bash
magents groups                                # what this project has
magents groups add Active --default           # make one, and point new work at it
magents groups add Done --hibernates          # …and one that sleeps what arrives
magents groups default Backlog                # move the default
magents groups hibernate Done [--off]         # toggle the rule
magents groups rename Backlog Later           # rename one
magents groups move Done --first              # to the top of the project
magents groups move Done --after Active       # just below a named neighbour
magents groups rm Later                       # drop it; its sessions stay
magents new -p codex --prompt "…" -g Active   # open one in a named bucket
magents new -p codex --prompt "…" --no-group  # none, even where a default exists
magents move "JIRA-1979" Done                   # move it; Done stops the agent
magents move "JIRA-1979" --none                 # out of whatever bucket it is in
```

`move` takes no `--project`, and that is deliberate rather than missing: a
session belongs to a project and groups belong to projects, so naming the
session has already settled which one. A flag there would let somebody ask for a
move into a bucket in another repository — which the daemon would take and the
roster could never draw.

A group is named by its title or the front of its id, and looked up **inside the
project** — `Active` in two repositories is two buckets, which is the point of
them, and a global lookup would refuse the obvious name the moment it was used
twice.

`groupId` is three-valued on the wire and that is the one distinction worth
protecting: absent means "you decide" and lands in the project's default, a
string is a bucket somebody chose, and an explicit `null` is *none*. Without the
third, a project with a default could never be opted out of.

### Spawning one

`⌃n` with a project selected, or the `+ spawn session` row under it. Both open
the prompt box — the same `SkillTextarea`, pointed at that project's skills —
with the provider on `⌃p` and the model it will run on under the box.

The provider and model open on what was last spawned **in this project**. That
is a preference, not a row: it lives in `~/.magents/tui.json`, keyed by the
project's path, written when a spawn succeeds and read when the panel opens.
It used to be read off the newest session anywhere, which answered "what did I
last run" and not "what do I run here" — and the two differ the moment two
repositories want two models. The sessions are still the fallback, for a
project with nothing written yet and for `⌃p` onto the other provider, where
the preference has no model to offer. The file is the TUI's own and the daemon
never reads it; it is the place for the next preference of this kind too.

The line above the box says where it is going — the project, and the bucket. It
opens on the project's default and `⌃g` walks the rest, with *none* at the end
of the ring rather than the front: a project that has said where work goes has
answered, and opening on *none* would ignore it. The key does not appear at all
when there is nowhere else to put it. Unlike the model, the group is **not**
remembered from last time — the default is the project's own answer, so it is
the right starting point every time rather than whatever was picked last.

Submitting opens the session and closes the panel, and the process is already
running by then: starting it is the daemon's, on its side of the socket,
finished before the call answers. Nobody has to open a pane for the agent to
work, and closing the one that is open does not stop it.

For codex it is running too, and for a while it was not, which is worth a
paragraph because the fix is a trick. Codex has no `--session-id`: it mints its
own id and does not save a resumable session until a run has actually happened.
Taken at face value that meant opening one by running the whole first turn
headlessly and reading the id out of its output — `magents new -p codex` was
measured holding the request for **2m 8s** while the identical claude command
answered instantly. It was then moved off the request, behind an
`opensInBackground` flag, with the row written handle-less and filled in when
the run landed; faster to answer, no faster to open.

What codex does have is `resume`, and `resume` never mints an id: it reads one
off the rollout on disk and carries on. So the daemon writes the rollout first.
One line — a `session_meta` naming the row's own id, the project directory and
the moment, filed where codex files its own under `~/.codex/sessions` — and the
pane's first command is `codex resume <id> "<prompt>"`, which codex accepts,
appends to, and answers with the id it was handed. Verified on 0.150.1, headless
and interactive, with the model flag honoured. The id is the row's, exactly as
with claude, so `resume` is a fixed argv on both sides of the socket and the
`opensInBackground` machinery is gone. The first line is written with `wx`, so
an id that already has a rollout is refused rather than claimed.

All of it leans on the rollout's first line being what codex reads, which is
undocumented, and codex has an open request for the flag that would make it
unnecessary: [openai/codex#7801](https://github.com/openai/codex/issues/7801),
*"Allows specifying a SessionID for better embedding of automated workflows"* —
`--session` on `codex exec`, which is claude's `--session-id` under another
name. If it lands, the rollout stops being ours to write.

Plain `enter` belongs to the box — a prompt worth writing is often more than one
line, and a form that sends on the first newline cannot take one. Sending is a
chord, and the button says `⌃s`, which is a control byte that survives any
terminal. `⌃⏎` is accepted too and is not advertised: the label used to be
chosen from the kitty capability the renderer reports, and that reports the
protocol being negotiated rather than `⌃⏎` actually arriving as its own key — so
on a terminal that claimed it, the button named a key that did nothing. A label
is a promise, so it names the one that cannot fail.

The row replaced a `no agents yet` line under empty projects. The heading
already shows a count of zero, and two lines saying the same thing under every
empty project is one line of clutter per project.

It is a button, not a row the cursor lands on — the same as `+ add project` at
the foot of the sidebar. The cursor walks projects, sessions and agents, which
are things; a button is not one of them.

### Removing one

`⌃d` with a project selected, or *delete project* in the header while one is.
Both open the same question, and the question is the point: this cannot be
undone.

The panel says what goes and, just as much, what does not. *Delete project*
reads like it deletes the repository, and that is the fear worth answering out
loud — the row goes, the sessions go with it, **the files stay exactly where
they are.**

`enter` confirms. That is the destructive key as the default, which is normally
wrong; here it is the entire purpose of the panel, and you had to ask for the
panel to see it. `esc` and clicking away cancel.

There is no `×` on the row itself, any more — there was one on every project
and session, which put a destructive target on the two rightmost columns of the
most casual part of the screen, two easy columns from the click that only meant
"select". The remove now lives a deliberate distance from the list, in the
header, named. Selecting and removing were always different intentions; they
have different places now too.

Afterwards the cursor goes home. What it was on is gone, and every other thing
that changes what is visible — the filter, the search — sends it home too.

### What enter means

One rule, and it is visible on the screen: **enter takes the highlighted row,
and there is a highlighted row exactly when the field is not already an
answer.**

| the field                  | highlighted | enter          |
| -------------------------- | ----------- | -------------- |
| a partial name             | the first match | takes it   |
| a directory that is there  | nothing     | adds it        |
| a directory, arrowed into  | that row    | takes it       |

So the highlight is a promise about the next enter, and it is kept. Typing
`~/code/thi` and pressing enter twice completes and then adds — which is what
the keystrokes look like they should do.

The first version got this wrong in both halves. It highlighted the first row
always, including when enter would submit, so a row looked chosen while enter
ignored it; and it answered enter inside the picker, which does not work at all,
because `<input onSubmit>` fires on enter regardless — the path completed *and*
submitted in the same keystroke, and the half-typed path came back refused.

That is why the highlight lives in `usePathCompletion` and not in `FilePeek`:
**one thing has to decide what enter means**, and the form is where the other
meaning of enter already lives. `takeEnter()` returns whether it took the key,
so the form reads as `if (completion.takeEnter()) return;` before it submits.

`tab` completes whether or not a row is highlighted — there is always a first
match, and tab is asking for it. Clicking a row picks it. The `add` button
always adds: clicking add means add, even with a row highlighted.

`FilePeek` itself is presentational, like everything in `ui/`. It is handed the
entries and which one is highlighted, and it reports a click.

The form shows the daemon's own sentence when a path is refused, and stays open
with what you typed still in it. Nothing is translated on the way through: the
daemon is the only thing that knows why the path was no good.

One character before the tagline says whether the last call was answered: green,
amber, or a faint ring while it is still asking. No label. Where projects come
from is not something the screen needs to teach — it matters exactly when it
stops working, and then the colour is the whole message. It earns a permanent
character rather than a one-off error because every project on the screen came
through it, and "the roster is short" and "the backend is down" look identical
otherwise. Clicking it is a `refetch`.

The three states are the query's own — `isPending`, `isError`, neither. There is
no status field anywhere that a call site has to remember to set, which is the
kind of status that goes wrong: the thing being described and the thing being
read are the same object.

When a call fails the roster does not blank out. The last good answer stays on
the screen and the dot says it is stale, which is more useful than an empty
list and no explanation.

`DaemonUnreachable` is still its own error type, but its job now is the
sentence: a socket that will not connect says *start the backend*, where an
errno would say `ENOENT` and leave you to work it out.

The same restraint applies to the words: the key list says "add a project", not
"register a project with the daemon". Which process does the writing is an
implementation detail, and putting it in front of the user makes it their
problem.

A registered project keeps its group even with nothing in it. An empty group is
the only way "you just added this" is visible, and dropping it would make adding
a project look like it did nothing. Which group is registered is a field on the
group, not an inference from the agent count — that rule holds today only
because seeded groups are dropped when empty, and it would quietly become wrong
the moment a real project has an agent in it.

The search runs over projects too, by name and by path, so the count under the
tagline counts both. Otherwise it would read "no matches" over two visible
project rows.

## Skills, one slash away

`SkillTextarea` is a box to type into with the project's skills behind a `/`.

```tsx
<SkillTextarea
  projectPath={project.path}
  width={62}          // the picker's row width, so its columns have a budget
  height={4}
  onSubmit={(text) => send(text)}
/>
```

It reads four directories — `~/.claude/skills` and `~/.codex/skills` for the
user, `.claude/skills` and `.agents/skills` in the repository — plus the skills
of every installed plugin. It parses the `name` and `description` out of each
`SKILL.md` and caches the lot under react-query keyed by project. A directory
that is not there is not an error; most machines have two of these four.

### Plugins

Plugin skills do not live anywhere guessable, and the two obvious places to look
are both wrong:

- `~/.claude/plugins/marketplaces/…` is the **catalogue** — every plugin on
  offer. Walking it lists hundreds of skills nobody installed.
- `~/.claude/plugins/cache/…` keeps **every version ever fetched** side by side,
  `superpowers/6.2.0` next to `superpowers/6.3.0`. Globbing it shows the same
  skill twice, one of them stale.

`installed_plugins.json` is the only thing that knows which version is the
installed one, and it says so as an absolute `installPath`. That is what
`pluginSkillRoots()` reads, and nothing else.

**Layouts differ underneath.** The common one is `skills/<name>/SKILL.md`, but a
plugin may file them by category — `skills/productivity/handoff/SKILL.md`. A
flat read finds *nothing at all* in the second, which is how a whole plugin went
missing. So a folder holding a `SKILL.md` is a skill and is not descended into,
and anything else is a shelf of them and is, to a bounded depth. Bounded because
a plugin is a checked-out repository: `node_modules` and its own dot-directories
are down there and neither holds skills.

On this machine that is 1 user skill and 50 from plugins, across three of the
five installed — the other two ship no skills at all.

Every row carries its provider's mark: the same diamond the roster uses, orange
for claude and green for codex. A skill belongs to whichever convention it was
found under, and both can offer one by the same name, so duplicates are kept and
the mark is what tells them apart.

The right-hand column says where a skill came from when that is not the ordinary
answer: the plugin's name, or `local` for one kept in the repository. A
user-level skill says nothing, because it is the default — the same way `git` is
marked in the path picker and its absence is not.

**Rows are names only.** The description of the highlighted one goes under the
box, word-wrapped to three lines — a description squeezed into each row is five
sentences cut off at forty characters, which is five things you cannot read
instead of one you can. It falls back to whatever the caller passed as `hint`.

Those three rows are **reserved, not a maximum**. The panel is centred, so a row
gained or lost moves the whole dialog in both directions, and arrowing through
the picker would make it jump on every description longer than the last. Three
rows of sometimes-empty is the price of a still panel — `height: 3`, not
`maxHeight: 3`.

Wrapping is done by hand, in `wrapClamped()`, because OpenTUI gives two of the
three pieces and categorically not the third. A `<text>` already wraps at its
own width (`wrapMode` defaults to `"word"`) and a fixed `height` already clips
the extra rows, but nothing marks the cut: the one native ellipsis, `truncate`,
is single-line, needs `wrapMode: "none"`, and puts the dots in the *middle*.
OpenTUI's own widgets do the same manual cut — `TabSelectRenderable.truncateText`
is `substring(0, maxWidth - 1) + "…"`.

The helper's output is rendered as one `<text>` with `wrapMode: "none"`. The
lines are already broken; leaving the default would re-wrap them, and a `width`
one column too generous would grow a fourth row and shove everything below it.
With wrapping off, the same mistake clips a tail instead. The `…` is counted
*inside* the width for the same reason — a line one column too long does not
lose its tail, it loses the marker.

That width is handed down from whoever chose the panel width
(`open-spawn-agent.tsx` → `modalMetrics.inner(68)`), because the geometry has to
have one home: `modalMetrics` is what the primitive styles its padding from, so
the padding cannot change and leave a content width behind.

**The slash has to open a word** — preceded by whitespace or nothing. Without
that rule every path typed into the box opens the picker, and `src/lib` is not
someone asking for a skill. Verified: typing `on src/lib` leaves the picker shut.

**A trailing space does not end it.** Typing `/do` and then a space is not
finishing with the picker, it is the moment right before writing what the skill
is for — so the caret steps back over spaces to find the name, and the skill
stays on screen with its description until the next real character lands. A
newline does end it: that is a break, not a pause.

The token carries whether that happened, as `settled`, because it changes what
the list means: a name still being typed is a search, and a name with a space
after it is a name.

That has a consequence worth stating, because it bit twice. A completed `/do `
is still a `/do ` the caret is sitting in, so `enter` would re-accept what it
had just accepted instead of starting a new line.

The first fix was a flag — *this was accepted, stay shut* — and it was wrong in
a way the test that passed did not show: a flag holding `"/do "` cannot tell one
`/do ` from another, so writing a second mention of a skill used once killed the
picker for it. Reported as "`/do` + space closes the picker", and it did.

What replaced it is read off the text: the word under the caret already **is**
the highlighted skill's mention, so there is nothing left to insert. The picker
stays visible either way — the skill and its description are worth seeing while
the rest of the line is written — and only the key gives way, falling through to
the textarea, where `enter` starts a new line like it does everywhere else.
Arrow to a different skill and the word stops matching, so `enter` swaps the
mention instead.

Both sides of that comparison spell the mention through `skillMention()`, and
name matches are ranked exact-first, so `/do ` highlights `do` and not `ado` —
without that ranking `enter` would helpfully replace what was just written.

Completing swallows a following space, since the mention brings its own:
`write /do| now` comes out `write /do now`, caret before `now`, not with a gap
in it.

**A visible picker is not a form that has gone away.** The picker outranks the
modal it sits in, deliberately, so that `esc` dismisses the list rather than the
form — and the screen used to decide whether a global chord was allowed by
asking who *owned* the keyboard. With `/do ` typed and the list still up that
answered `suggestions` rather than `modal`, and let every chord straight
through: `⌃g` in the spawn box cycled the group **and** opened the new-group
form over the top, closing the box it had just been typed into. The guard now
asks whether a modal is on the screen at all, which is the question it always
meant to ask.

Matching goes name first, then description. A slash is someone reaching for a
name they half remember, so anything the name matches outranks everything the
description matches — but the description is still searched, because half the
time the name is the part they do not remember at all.

**The space also ends the searching.** While the caret is in the word, `/do` is
someone looking, and `dotnet-inspect` and `handoff` are fair answers. Once the
space is typed the name is finished, and the only skill that answers to `/do` is
the one called `do` — so a settled name is matched, not searched, and a settled
name nothing answers to closes the list rather than offering near misses.

The list is **above** the box. The box grows downward as it fills, and a list
under it would be shoved around by the thing it is describing.

### Taking the keys off the textarea

Every key the picker uses is a key the textarea already has: `↑` `↓` move the
caret, `return` inserts a newline. They are taken with `preventDefault()` — a
global key handler runs before the renderable's own, so marking the event
handled is enough to stop the editor acting on it. No key bindings to override,
nothing to put back when the picker closes.

`esc` is the one that needed more than that. The textarea will usually be inside
a modal, and dismissing a list is not abandoning a form — so an open picker is
its own `KeyboardOwner`, outranking the modal, and the screen steps aside for
it. Verified: with a picker open inside a modal, the first `esc` closes the
list, the second closes the modal, and the shortcut bar says which is which at
each step.

The textarea is uncontrolled — OpenTUI's owns its buffer and takes an
`initialValue` — so the text and the caret are read back off the renderable on
every content and cursor change rather than pushed into it. That is also what
makes the caret usable: the picker needs to know *where* the slash is, not just
that the text has one, and a controlled `value` would not say. Accepting a
suggestion rewrites the word the caret is in through `replaceText`, so the whole
thing is one undo away.

## Modals are spawned

Nothing renders `<SomeModal />` and holds a boolean beside it. A call site
describes the modal it wants and hands it over:

```ts
openModal({
  title: "keys",
  width: 56,
  backdrop: theme.bg,              // optional; what the screen is dimmed towards
  children: (close) => <Keys onClose={close} />,
})
```

### Getting out is the primitive's job

Every panel draws its own way out, at the right of its title row, on the border
itself: an absolutely positioned `<text>` at `top: -1, right: 0` inside the
panel box. Children paint after the border, so it lands on top of it — no
`zIndex`, no column arithmetic, and the offsets are relative to the padding box
so the panel's padding does not have to be compensated for.

Two things that are not obvious and were measured, not assumed:

- **It needs its own `bg`.** A `<text>` leaves its space cells transparent, so
  without `bg: theme.panel` the border draws a dash straight through the gap in
  the label: `┌─ keys ──────esc─close┐`.
- **`overflow` on the panel must stay `visible`.** The control sits outside the
  padding box, so clipping the panel deletes it — silently, no error, leaving a
  modal with no visible way out.

The title is truncated by the primitive when it would collide, rather than
letting the control paint over its tail: a mangled word is worse than an
ellipsis, and the panel is the only thing that knows both lengths.

**The label follows the keyboard.** `ModalHost` passes `esc close` when the
modal owns the keyboard and plain `close` when something outranks it — with a
suggestion picker open, `esc` dismisses the list and leaves the modal standing,
so advertising the key there would be a lie. The primitive stays store-free; the
host, which already reads the modal store, reads the owner too.

Content therefore has no close buttons. `cancel` stays where it is the negative
half of a two-button choice (`add`, `remove`) — a destructive confirm should not
present its destructive action as the only button — but a lone `close` inside a
panel that already has one is duplication. Three mouse exits remain: the scrim,
the layer outside the panel, and the control.

`hint` keeps only what the panel alone knows: `enter remove` on the destructive
confirm is the sole advertisement of its unconditional `enter` handler, and
dropping it as "redundant with esc" would have hidden a destructive keybinding.

The panel sits over a dimmed screen, and the two are **siblings, not nested**.
`opacity` in OpenTUI multiplies down the tree, so a panel declared inside the
scrim inherits its opacity and the roster shows straight through the dialog.
Side by side, the scrim dims what is behind it and the panel is painted at full
strength above it — measured: `#a78bfa` in the roster reads back as
`rgb(96, 82, 146)` under the scrim, exactly `fg * 0.55 + bg * 0.45`, while the
panel's accent is still `#22d3ee`.

Both layers close on click. The scrim is what the eye sees, but the layer that
catches a click outside the panel is the centring one above it.

`children` is given the function that closes *this* modal. Whatever the content
puts that on — a button, a shortcut, a click — closes it, and the content never
reaches into a store to do it. `<ModalHost />` is mounted once near the root,
because a modal has to escape the layout it was opened from.

The spawn is not in the component's file. Actions live in `actions/`, one file
per action, and they are the only thing that composes stores and components:
`open-help.tsx` builds the spec, `help-keys.tsx` only renders. A component that
also exports the verb that opens it is a file doing two jobs.

### Who has the keyboard

```ts
type Focus = "roster" | "search"          // useAppStore
modal: ModalSpec | null                   // useModalStore
open: boolean                             // useSuggestionsStore
```

Not a flag per widget: two booleans can both be true, and "the roster and the
search are both focused" is a state with no meaning that someone would have to
handle. **The modal is not a third case in `Focus`** — it outranks it, and an
open suggestion picker outranks even that. The precedence lives in
`keyboard-owner.ts` and only there, in two shapes: a hook for components, a
plain call for key handlers.

Ranking instead of replacing is what makes closing a modal hand the keyboard
*back*: open one on top of the search, close it, and the search still has it,
still holding what was typed. The screen's key handler reads as a switch on the
owner rather than a pile of guards.

The picker sits at the top of that ranking for one key. `esc` dismisses it, and
it must not also close the modal it is inside — dismissing a list and abandoning
a form are different intentions and they deserve different keystrokes. That is a
global flag for something a component owns, which needs the justification: the
keyboard is global, so the answer to "who has it" belongs where the rest of that
answer already lives.

## Wordmark

A highlight band sweeps the MAGENTS wordmark left to right, always running.
`--no-pulse` is the only thing that stops it, and it is read once at startup —
so the component renders once and never again.

`ASCIIFontRenderable` colors a glyph by the font's own color layers — one flat
color for `tiny` — so `src/lib/wordmark.ts` builds the glyph rows from the font data
and emits one styled chunk per column. That is what buys per-column control.
The sweep itself is `CYCLE`, `BAND` and `RESTING` at the top of the file.

## Layout

```
  MAGENTS   │ agent control plane                        ~/code/magents
            │ 11 agents                          delete project | ? keys
───────────────────────────────────────────────────────────────────────
 ⌕ search agents…  │
                   │
 ▾ magents       3 │
 ▎ reviewer   ◆    │   the detail pane, empty until there is
 ▎ explorer   ◆    │   something worth putting in it
 ▎ migrator   ◆    │
                   │
 ▾ atlas-api     3 │
 ▎ schema-guard ◆  │
 / search  ↑↓ navigate  p provider  q quit
```

The header carries what the sidebar leaves out: the count on the left, and on
the right the full name of whatever is selected — in bold, because the action
words directly under it are in the same ink and weight is what says one line is
a name and the other is verbs. The actions sit beside `? keys` — buttons, not
captions: each opens the same panel its chord opens. *add group · delete
project* on a project; *edit group · delete group* on a group; *rename session
· change group · start/hibernate session · delete session* on a session, where
start and hibernate appear on the same terms the footer offers their keys —
only when true, and never both. A dot joins the verbs, a bar separates them
from the button that is always there — the footer's grammar. When the terminal
is too narrow for all the words they drop one at a time from the left rather
than clip, because half a word is not a button and the rightmost are the ones
that must survive — *delete* is the `×` this line replaced; the chords keep
working regardless. The name above them is a button too, on the two rows whose
name is anybody's to edit: a session's opens the rename, a group's opens the
edit panel. The shortcut bar stays along the bottom and lists only the keys
that are live for whoever holds the keyboard. The provider filter has no
indicator of its own; what it did is visible in the roster and in the count.

**A border and a clip together take the bottom row away from the mouse.** The
`? keys` button was a `PressableText` from the day it was written and did
nothing when pressed, and did not light up under the pointer either, which is
the same fact twice: hover and click are the same hit test. The header had
`overflow: hidden` as a backstop against a long name, and a `borderColor` left
behind when the border above it was commented out — a colour on its own is
enough to draw one. With both, the last row inside the border answers as the box
rather than as the child sitting on it: the clip rectangle is not offset by the
border the way the paint is. The button lives on exactly that row. The border
went, since there are no borders anywhere else in this app and the seam between
the panes is a change of background, and the button works. Worth knowing before
putting anything clickable along the bottom edge of a box that clips.

## Structure

```
daemon/                  the backend process, and every agent's terminal
  index.ts               refuse a second instance, sweep, migrate, listen, stay up
  routes/                one route per file, each mapping its own failures
    handle-request.ts    the routing table
    get-projects.ts      post-projects.ts      delete-project.ts
    get-sessions.ts      post-sessions.ts      delete-session.ts
    get-session-attach.ts     the websocket upgrade; a pane joins here
    post-session-terminal.ts  delete-session-terminal.ts   start it, stop it
    get-models.ts        get-health.ts
  services/              one operation per file, one named export each
    database.ts          the open, migrated, scoped connection
    claim-database.ts    one daemon per database, refused rather than assumed
    start-server.ts      the scoped listener, and the websocket handlers
    terminals.ts         the PTYs: spawn, history ring, clients, size, reap
    start-terminal.ts    the one path that puts a process back on a session
    reconcile-terminals.ts    the boot sweep over pids a dead daemon left
    open-session.ts      mint with the provider, write the row, start it
    remove-session.ts    kill first, then delete — the ordering one process has
    list-sessions.ts     the rows, with the live registry overlaid on them
    resolve-project-path.ts   expand `~`, absolutise, refuse a non-directory
    create-project.ts    remove-project.ts    list-projects.ts
    find-project-by-path.ts
  providers/             what a provider is, and one adapter per provider
    provider-adapter.ts  models, open, resume, and how long it settles
    codex.ts             claude.ts            adapters.ts
  errors/                tagged failures, one per file
    database-error.ts  invalid-path-error.ts  provider-error.ts
    malformed-request-error.ts  server-error.ts  terminal-error.ts
  lib/                   pure, no Effect
    attach-frames.ts     the attach wire protocol, imported by both sides
    pid-identity.ts      pid plus start time, so a stale one is not a stranger
    normalize-path.ts  folder-of.ts  expand-home.ts  expire.ts
  paths/
    magents-home.ts  db-path.ts  socket-path.ts  migrations-dir.ts
  db/
    schema/              one table per file, relations alongside
      index.ts           gathers them into `schemas`, what drizzle is handed
      projects.ts        projects-relations.ts
      sessions.ts        sessions-relations.ts
  migrations/            generated by drizzle-kit, applied at boot

install.sh               build, install, and the systemd user service

client/                  the daemon's client, one call per file — shared
  request.ts             one call over the unix socket
  open-session.ts        list-sessions.ts     remove-session.ts
  import-session.ts      rename-session.ts
  start-terminal.ts      create-project.ts    list-projects.ts
  remove-project.ts      list-models.ts       check-health.ts
  daemon-unreachable-error.ts    the absent daemon, told apart from an answer

cli/                     the command line onto the same daemon
  index.ts               the command table, --help, and the exit statuses
  command.ts             what a command is; the usage error
  commands/              one command per file, each owning its own flags
    projects.ts          sessions.ts          models.ts
    new.ts               rename.ts            attention.ts
    hooks.ts             how each provider is told about the hook, in one place
  lib/
    resolve-project.ts   a path, a name, or an id — the cwd by default
    resolve-session.ts   the same, over sessions, by title as well
    find.ts              exact name beats prefix; two hits is refused
    codex-config.ts      the hook into their config.toml, theirs left intact
    hook-payload.ts      what the provider wrote on stdin; subagent or not
    columns.ts           aligned output, and how much of an id to show

src/                     the TUI
  index.tsx              renderer bootstrap + createRoot(...).render(<App/>)
  app.tsx                where screen routing will live
  constants/
    bindings.ts          the keyboard: keys, labels, descriptions, behaviour
  queries/               react-query: the backend's state, not ours
    query-client.ts      the one client, readable from outside React
    projects-query.ts    sessions-query.ts    models-query.ts
    health-query.ts      skills-query.ts
    use-add-project.ts   the mutation, and the invalidation that follows it
    use-remove-project.ts     use-remove-session.ts     use-open-session.ts
  lib/
    session-terminals.ts every session's screen and socket, outside React
    attach-terminal.ts   the attach socket: replay, live bytes, keys back
    quiet-stderr.ts      fd 2 to a file, so nothing draws over the frames
    roster.ts            search and grouping, pure
    last-choice.ts       what was last spawned anywhere, and where a model list starts
    tui-preferences.ts   ~/.magents/tui.json — the last spawn per project
    agents.ts  theme.ts  flags.ts  read-skills.ts  wordmark.ts
  hooks/
    use-daemon-heartbeat.ts   the beat that keeps the dot and the roster honest
    use-model-selection.ts    use-provider-choice.ts    use-follow-launch.ts
    use-remembered-spawn.ts   use-seen-session.ts       use-frame.ts
    use-skill-suggestions.ts  use-path-completion.ts
  actions/               one file per action, the only place stores compose
    open-help.tsx        spawns the key list
    open-add-project.tsx spawns the form that registers a repository
    open-remove-project.tsx   asks before forgetting one
    open-spawn-session.tsx    spawns the prompt box for a project
    open-remove-session.tsx   asks before dropping a session
    open-hibernate-session.tsx     asks before stopping its agent
    toggle-help.ts       what the `? keys` button does
    quit.ts              close the sockets and leave; the agents stay up
  screens/
    agents-screen.tsx    the roster screen: layout + key bindings
  components/
    header.tsx           wordmark, tagline, count, selected path
    sidebar.tsx          the left column: search on top, roster under it
    search-bar.tsx       the one search field, focused with `/`
    roster.tsx           the session list, grouped by project folder
    detail-pane.tsx      the right side: the pane, and what it can say
    session-terminal.tsx the window onto a session's terminal
    add-project-form.tsx one field, the backend's answer under it
    skill-textarea.tsx   a box to type in, with skills behind a `/`
    spawn-session-form.tsx    the prompt box: provider, model, variant
    spawn-session-button.tsx  the `+ spawn session` row under a project
    confirm-remove-project.tsx     confirm-remove-session.tsx
    confirm-hibernate-session.tsx  the question before an agent is stopped
    add-project-button.tsx    the mouse's way to what `n` does
    daemon-status.tsx    the status dot beside the tagline; click to retry
    footer.tsx           the shortcut bar, which follows the keyboard
    help-keys.tsx        the key list — the modal's first tenant
    modal-host.tsx       renders whatever was last spawned
    model-line.tsx       the model and variant row, cycled by key or click
    ui/                  presentational only: handed data, reports a click
      modal.tsx          the primitive: a box, a title, a way out
      suggestion-picker.tsx     the skills a `/` could mean
      provider-mark.tsx  the diamond, filled while a process is running
      badge.tsx          file-peek.tsx
  store/                 zustand: what this process believes, not the backend
    use-app-store.ts     cursor, search, focus, and where a launch is going
    use-modal-store.ts   whatever was last spawned
    use-suggestions-store.ts  the picker's list and its highlight
    keyboard-owner.ts    who gets a key, asked in one place
```

Filenames are kebab-case, exports keep their own casing — `search-bar.tsx`
exports `SearchBar`. Biome's `useFilenamingConvention` enforces it, so the
convention is checked rather than remembered.

The rule that keeps this honest: **`lib/` never imports React or the store.**
Components read state through hooks, and everything below `lib/` stays testable
on its own.

## State

Two kinds, kept apart on purpose.

**What the screen is doing** is a zustand store: the cursor, the query, who has
the keyboard. Writes come from key bindings today and will come from provider
adapters later — `useAppStore.setState` works from outside React, so a running
agent can push status without a bridge into the component tree.

**What the backend has** is [react-query](https://tanstack.com/query). Loading,
error and stale are not things worth hand-rolling: the first version of the
status dot was a `status` field plus an `error` field that every call site had
to remember to set, and a status you have to remember to set is a status that
will be wrong. `useQuery` describes the fetch that is actually happening.

The client is a module singleton, because the cache is read from outside React
too — `moveCursor` counts the rows the roster paints, and it runs in a key
handler where there is no render and so no hook to call.

Two defaults are deliberate. **No retries:** the backend is a socket on this
machine, it answers or it is not running, and three retries with backoff would
only delay the amber dot that says so. **Never stale on its own:** nothing here
is a feed, so a refetch is something a mutation asks for by name.

Mutations invalidate rather than patch the cache. `useAddProject` uses
`onSettled`, not `onSuccess`, because a failure is worth a refetch too: if the
add failed because the backend went away, that refetch is what turns the dot
amber. Without it the dot would sit on a success it read minutes ago.

Two rules worth keeping:

- **Select slices, never the whole store.** `useStore()` with no selector
  re-renders the entire tree on every write; with 200 rows that measured 0.95 ms
  per frame against 0.39 ms for selector-scoped reads.
- **Derived reads are hooks, not selectors.** A selector returning a fresh array
  every call re-renders forever under zustand's reference check, so
  `useVisibleGroups()` composes three stable selectors with a memo, and
  `useVisibleAgents()` flattens that memo instead of rebuilding it.

60fps values never enter state. `Wordmark` mutates its renderable through a ref
inside `useFrame`, which costs no React renders at all — measured identical to
the imperative version. The sweep runs every frame and re-renders this app
exactly zero times.
