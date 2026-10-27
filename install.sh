#!/usr/bin/env bash
#
# install.sh — builds magents, puts it on PATH, and runs the daemon under
# systemd. The same script installs and updates; there is no separate update
# path, because an update is an install over the top of the last one.
#
# Three binaries come out of it:
#
#   magents          the TUI
#   magents-cli      the command line
#   magents-daemon   the backend, started by systemd rather than by hand
#
# The daemon is a *user* service and not a system one. It is not a preference:
# it spawns claude and codex as you, reads the config in your home directory,
# and owns ~/.magents. As a system service every agent would be root's.
#
# One deliberate departure from the obvious order: the build happens before
# anything is stopped. Stopping first would mean a compile error costs you every
# running agent and leaves you with the version you already had — the warning up
# top promises the sessions come back after the update, and an update that fails
# to build never arrives. Nothing is moved into place until all three binaries
# exist.
#
#   ./install.sh            ask first
#   ./install.sh --yes      do not ask
#   MAGENTS_PREFIX=~/.local ./install.sh
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${MAGENTS_PREFIX:-/usr/local}"
BIN="$PREFIX/bin"
SHARE="$PREFIX/share/magents"
DIST="$REPO/dist"
UNIT_NAME="magents-daemon.service"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SKILL_SRC="$SHARE/skills/magents"
# where each provider looks for skills of its own: "name dir" pairs
SKILL_HOMES=(
	"claude ${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
	"codex ${CODEX_HOME:-$HOME/.codex}"
)

# every executable this installs, in the order it is safe to stop them: the
# screens first, so a pane loses its socket before the thing on the other end
# of it goes away, and the daemon last
PROGRAMS=(magents magents-cli magents-daemon)

ASSUME_YES=0

step() { printf '\n\033[1m==>\033[0m %s\n' "$1"; }
info() { printf '    %s\n' "$1"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$1" >&2; }
die() { printf '\033[31m  ✗ %s\033[0m\n' "$1" >&2; exit 1; }

usage() {
	cat <<'USAGE'
install.sh — build magents and install it

usage
  ./install.sh [--yes]

flags
  -y, --yes    do not ask for confirmation
  -h, --help   this

environment
  MAGENTS_PREFIX   where the binaries go; /usr/local by default, and
                   ~/.local works without sudo if it is on your PATH
USAGE
}

for arg in "$@"; do
	case "$arg" in
		-y | --yes) ASSUME_YES=1 ;;
		-h | --help)
			usage
			exit 0
			;;
		*)
			usage >&2
			die "unknown option $arg"
			;;
	esac
done

# ─────────────────────────────────────────────────────────────── preflight ──
# Asked before anything is promised. Finding out about any of this after the
# agents have been killed would be the worst possible moment.

# Bun is the one prerequisite this script can supply itself, so it does. The
# official installer puts it under ~/.bun and offers to edit the shell profile;
# what matters here is the rest of *this* run, which is why the bin directory
# goes on PATH by hand — the profile edit lands in the next shell, not in this
# one. The three binaries built below embed the runtime, so bun is needed to
# build and never again to run.
if ! command -v bun >/dev/null 2>&1; then
	step "installing bun"
	command -v curl >/dev/null 2>&1 || die "bun is not on PATH and curl is not here to fetch it — see https://bun.sh"
	curl -fsSL https://bun.com/install | bash
	export PATH="${BUN_INSTALL:-$HOME/.bun}/bin:$PATH"
	command -v bun >/dev/null 2>&1 || die "bun was installed but is not on PATH — open a new shell and run this again"
	info "bun $(bun --version)"
fi

systemctl --user show-environment >/dev/null 2>&1 ||
	die "no systemd user manager here — the daemon has nowhere to be a service"

# sudo only if the destination is not already ours, worked out now so the
# password prompt does not turn up in the middle of the install.
#
# The walk up matters: a prefix that does not exist yet has to be judged by
# whoever owns the first parent that does. Looking only one level up said "sudo"
# about a directory three levels below /tmp, which is a password prompt for a
# tree the user already owns.
nearest_existing() {
	local path="$1"

	while [ ! -e "$path" ] && [ "$path" != "/" ]; do
		path="$(dirname "$path")"
	done

	printf '%s' "$path"
}

SUDO=""
[ -w "$(nearest_existing "$BIN")" ] || SUDO="sudo"

# ────────────────────────────────────────────────────── 1. ask, and warn ──
step "magents → $PREFIX"
info "binaries    $BIN/{magents,magents-cli,magents-daemon}"
info "migrations  $SHARE/migrations"
info "skill       $SKILL_SRC, linked into ~/.claude/skills and ~/.codex/skills"
info "service     $UNIT_DIR/$UNIT_NAME (systemctl --user)"
command -v codex >/dev/null 2>&1 &&
	info "codex       a [hooks] block in ${CODEX_HOME:-$HOME/.codex}/config.toml, and one prompt"
[ -n "$SUDO" ] && info "sudo        needed for $PREFIX"

printf '\n'
warn "every agent magents is running right now will be stopped"
info "the sessions themselves survive — they are rows in ~/.magents, and the"
info "conversations belong to claude and codex, not to us. after the update,"
info "open magents, pick a session and press ⌃r to put a process back on it."

if [ "$ASSUME_YES" -eq 0 ]; then
	[ -r /dev/tty ] || die "nothing to ask on — re-run with --yes if you mean it"

	printf '\n'
	read -r -p "go ahead? [y/N] " reply </dev/tty
	case "$reply" in
		y | Y | yes | YES) ;;
		*) die "nothing was changed" ;;
	esac
fi

# ────────────────────────────────────────────────────────────── 2. build ──
# First, and not where the numbered plan put it: see the note at the top.

step "building"
cd "$REPO"

bun install
mkdir -p "$DIST"

bun build --compile "$REPO/src/index.tsx" --outfile "$DIST/magents"
bun build --compile "$REPO/cli/index.ts" --outfile "$DIST/magents-cli"
bun build --compile "$REPO/daemon/index.ts" --outfile "$DIST/magents-daemon"

for program in "${PROGRAMS[@]}"; do
	[ -x "$DIST/$program" ] || die "$program did not build"
done

info "three binaries in dist/"

# ─────────────────────────────────────────────────────────────── 3. stop ──

step "stopping what is running"

if systemctl --user cat "$UNIT_NAME" >/dev/null 2>&1; then
	systemctl --user stop "$UNIT_NAME" || true
	info "service stopped"
fi

running() {
	local program
	for program in "${PROGRAMS[@]}"; do
		pgrep -x -- "$program" >/dev/null 2>&1 && return 0
	done
	return 1
}

for program in "${PROGRAMS[@]}"; do
	pkill -x -TERM -- "$program" 2>/dev/null || true
done

# SIGTERM and then wait, because the daemon's shutdown is the *only* thing that
# ends its agents on purpose — killed outright it releases nothing and the PTY
# children get hung up on by the kernel. Ten seconds, then insist.
waited=0
while running && [ "$waited" -lt 100 ]; do
	sleep 0.1
	waited=$((waited + 1))
done

if running; then
	warn "still there after ten seconds — killing"
	for program in "${PROGRAMS[@]}"; do
		pkill -x -KILL -- "$program" 2>/dev/null || true
	done
	sleep 0.5
fi

info "stopped"

# ────────────────────────────────────────────── 4. take the service away ──
# Removed rather than overwritten, so the unit that ends up on disk is this
# script's and carries nothing from whatever was there before.

step "removing the old service"

systemctl --user disable "$UNIT_NAME" >/dev/null 2>&1 || true
rm -f "$UNIT_DIR/magents-daemon.service"
systemctl --user daemon-reload
systemctl --user reset-failed "$UNIT_NAME" >/dev/null 2>&1 || true

info "gone"

# ──────────────────────────────────────────────────────────── 5. install ──

step "installing into $PREFIX"

$SUDO install -d "$BIN" "$SHARE/migrations/meta"

for program in "${PROGRAMS[@]}"; do
	$SUDO install -m 755 "$DIST/$program" "$BIN/$program"
done

# The daemon migrates the database at boot and reads the SQL off disk to do it.
# A compiled binary carries its JavaScript and nothing else, so these have to
# travel too — `daemon/paths/migrations-dir.ts` looks for them beside the
# executable, at exactly this path, which is why the unit sets no environment.
$SUDO install -m 644 "$REPO"/daemon/migrations/*.sql "$SHARE/migrations/"
$SUDO install -m 644 "$REPO"/daemon/migrations/meta/*.json "$SHARE/migrations/meta/"

# The skill that teaches an agent this CLI. It sits beside the binaries rather
# than in the checkout, so it always describes the version that is installed and
# survives the checkout being moved or deleted. Step 7 links it into place.
$SUDO install -d "$SKILL_SRC"
$SUDO install -m 644 "$REPO/skills/magents/SKILL.md" "$SKILL_SRC/SKILL.md"

info "$BIN/{$(
	IFS=,
	echo "${PROGRAMS[*]}"
)}"
info "$SHARE/migrations"
info "$SKILL_SRC"
# Said out loud because it is startling: bun embeds its whole runtime in every
# standalone binary, so three of them is a few hundred megabytes and nothing has
# gone wrong.
info "$(du -sh "$DIST" | cut -f1) in all — bun embeds its runtime in each binary"

# ────────────────────────────────────────────────────── 6. the service ──
#
# The PATH in the unit is the one thing here that has to be computed, and it is
# worth the trouble. A systemd user service does not inherit your shell's
# environment, so a daemon left to the default PATH cannot find a provider that
# was installed by a version manager — and the failure surfaces as a session
# that spawns and dies, far from the cause.
#
# Your PATH is not copied verbatim either. Version managers hand out per-shell
# directories that exist only while that shell does: on this machine `claude`
# lives under /run/user/1000/fnm_multishells/<pid>_<stamp>/bin, which is a
# symlink that will be gone by tomorrow. Every entry is resolved to what it
# actually points at, so what lands in the unit outlives the terminal you
# installed from.
#
# What that resolves to pins a version — the fnm entry above becomes the bin
# directory of the node it is currently pointing at — so upgrading the runtime
# your providers were installed under means running this again. That is the
# honest trade: a unit that names a directory which will exist tomorrow, rather
# than one that names the alias and breaks differently.

step "creating the service"

unit_path() {
	local entry resolved out=""

	while IFS= read -r entry; do
		[ -n "$entry" ] || continue

		resolved="$(readlink -f -- "$entry" 2>/dev/null || true)"
		[ -n "$resolved" ] && [ -d "$resolved" ] || continue

		# already have it — a resolved PATH collapses duplicates that looked
		# different before they were resolved
		case ":$out:" in
			*":$resolved:"*) continue ;;
		esac

		out="${out:+$out:}$resolved"
	done < <(printf '%s\n' "$PATH" | tr ':' '\n')

	printf '%s' "$out"
}

UNIT_PATH="$(unit_path)"

for provider in claude codex; do
	if ! (
		PATH="$UNIT_PATH"
		hash -r 2>/dev/null || true
		command -v "$provider" >/dev/null 2>&1
	); then
		warn "$provider is not on the daemon's PATH — sessions on it will not spawn"
	fi
done

mkdir -p "$UNIT_DIR"

cat > "$UNIT_DIR/$UNIT_NAME" <<UNIT
[Unit]
Description=magents daemon — the database, and every agent's terminal
After=default.target

[Service]
Type=simple
ExecStart=$BIN/magents-daemon
Environment=PATH=$UNIT_PATH
Restart=on-failure
RestartSec=2

# The daemon reaps its agents itself, and only on a SIGTERM it is allowed to
# handle. The default KillMode would signal every process in the cgroup at once,
# which takes the agents out from under the shutdown that exists to end them
# properly; mixed sends it to the daemon alone and leaves the children to it.
KillMode=mixed
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now "$UNIT_NAME"

# Linger is what makes it a daemon rather than a thing that lives as long as
# your last terminal. Not fatal if it is refused — the service still runs, it
# just starts with your session instead of with the machine.
if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || echo no)" != "yes" ]; then
	loginctl enable-linger "$USER" >/dev/null 2>&1 ||
		warn "could not enable linger — the daemon will stop when you log out"
fi

# Asked rather than assumed: `enable --now` returning 0 means systemd accepted
# the unit, not that the daemon came up. The socket is the real answer, so the
# check is a command that has to reach it.
for _ in $(seq 1 40); do
	"$BIN/magents-cli" projects >/dev/null 2>&1 && break
	sleep 0.25
done

if ! "$BIN/magents-cli" projects >/dev/null 2>&1; then
	warn "the service is up but the daemon is not answering — its own words:"
	journalctl --user -u "$UNIT_NAME" -n 20 --no-pager || true
	die "left installed; fix the above and \`systemctl --user restart $UNIT_NAME\`"
fi

info "running, and answering on its socket"

# ─────────────────────────────────────────── 7. teach the agents the CLI ──
#
# An agent asked to "open a session per ticket" has no way to know that
# `magents` is the TUI and will flood its shell, or that `-p` belongs to `new`
# alone. The skill says so, and both providers load skills from a directory in
# their home.
#
# One copy, two links: claude and codex point at the same file under the prefix,
# so an update rewrites that file and both see it, and there is never a stale
# copy in one home that disagrees with the other.
#
# A link is replaced, whatever it pointed at — it is either ours or an older
# ours. A real directory by that name is somebody's own skill and is left alone.

step "teaching the agents the CLI"

for entry in "${SKILL_HOMES[@]}"; do
	provider="${entry%% *}"
	home="${entry#* }"
	link="$home/skills/magents"

	if [ ! -d "$home" ] && ! command -v "$provider" >/dev/null 2>&1; then
		info "$provider is not installed — skipped"
		continue
	fi

	if [ -e "$link" ] && [ ! -L "$link" ]; then
		warn "$link is not a link of ours — left alone, $provider will not get the skill"
		continue
	fi

	mkdir -p "$home/skills"
	ln -sfn "$SKILL_SRC" "$link"
	info "$link → $SKILL_SRC"
done

# ────────────────────────────────────── 8. put the hook in codex's config ──
#
# The daemon adds a `Stop` hook to every agent it spawns so a session can say
# when it has finished and light its row. Claude takes it as an argument and
# there is nothing to install. Codex used to as well — `-c hooks.Stop=…`, next
# to the model — and it fired sometimes and not others, which is the worst way
# for it to work: an attention light you cannot trust means checking the dark
# rows by hand, which is the thing it was for.
#
# So codex's lives in its own config, where it is not an override on one
# invocation but simply what codex does.
#
# The editing is `magents-cli hooks codex --write` rather than shell here, and
# that is a deliberate move out of this file. Putting a table into a config
# somebody else wrote means reading TOML, and checking afterwards that the
# result is still their config plus one entry means reading it again — that is a
# program, not a pipeline. It keeps whatever hooks are already there, writes
# nothing unless the result parses and still holds every one of them, and says
# what it did. See `cli/lib/codex-config.ts`.

step "teaching codex the hook"

CODEX_HOOK=0

if ! command -v codex >/dev/null 2>&1; then
	info "codex is not installed — nothing to do"
elif "$BIN/magents-cli" hooks codex --write; then
	CODEX_HOOK=1
else
	# It has already said which file and why, above. Not fatal: everything else
	# is installed and working, and this costs codex sessions their attention
	# light rather than costing anything else.
	warn "codex sessions will not report when they finish until that is sorted"
fi

# ────────────────────────────────────────────── 9. let codex trust the hook ──
#
# The one step that cannot be done for somebody.
#
# Codex will not run a hook nobody has vouched for — it skips it in silence, no
# error, no warning, exit zero — wherever the hook was declared, and the only
# way to vouch is to be asked and to say yes, which needs a person at a
# terminal. Accepting persists, so it is once per machine, and again whenever
# the command changes, because trust is recorded against the string.
#
# Nothing is passed to codex here: the hook is in the config now, so plain
# `codex` is a session carrying it. Skipped under --yes, because "do not ask me
# anything" and "sit in front of a prompt for a minute" cannot both be honoured.

if [ "$CODEX_HOOK" -eq 1 ]; then
	step "letting codex trust the hook"

	if [ "$ASSUME_YES" -eq 1 ]; then
		info "skipped: --yes cannot answer a prompt that is not ours"
		info "run it later with:  ./install.sh   (and say yes here)"
	else
		printf '\n'
		info "codex only runs a hook somebody has vouched for, and vouching means"
		info "answering its own prompt. This opens a codex session: accept what it"
		info "asks, send one short message so a turn completes, then quit codex"
		info "however you normally would."
		printf '\n'
		info "It is needed once per machine, and again if the install path changes."
		info "Say no if you have already done it — nothing else depends on this."
		printf '\n'

		read -r -p "  open codex now? [Y/n] " reply </dev/tty

		case "$reply" in
			n | N | no | NO)
				info "skipped — codex sessions will not report when they finish"
				info "to do it later, re-run this script and say yes"
				;;
			*)
				# Plainly, with nothing around it. Wrapping an interactive
				# terminal program in `timeout` puts it in a process group of its
				# own, where reading the tty stops it with SIGTTIN — which looks
				# exactly like a hang.
				codex
				printf '\n'
				info "if codex asked and you accepted, every session from here has it"
				;;
		esac
	fi
fi

# ──────────────────────────────────────────────────────────── 10. done ──

step "done"

sessions="$("$BIN/magents-cli" sessions 2>/dev/null | tail -n +2 | wc -l)"

printf '\n'
info "magents          the TUI"
info "magents-cli      the command line — \`magents-cli --help\`"
info "magents-daemon   under systemd: systemctl --user status $UNIT_NAME"
printf '\n'

if [ "$sessions" -gt 0 ]; then
	info "$sessions session(s) came through the update. their processes did not —"
	info "open magents, select one and press ⌃r to put an agent back on it."
	printf '\n'
fi

case ":$PATH:" in
	*":$BIN:"*) ;;
	*)
		warn "$BIN is not on your PATH"
		info "add it to your shell profile:  export PATH=\"$BIN:\$PATH\""
		;;
esac
