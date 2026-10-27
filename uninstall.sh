#!/usr/bin/env bash
#
# uninstall.sh — takes magents off this machine: the service, the binaries,
# the migrations, the skill links, and the hook it put in codex's config.
#
#   ./uninstall.sh           ask first
#   ./uninstall.sh --yes     do not ask
#   MAGENTS_PREFIX=~/.local ./uninstall.sh
#
# `~/.magents` is deliberately not on the list. It holds the one part of an
# install that cannot be rebuilt — the sessions, the projects, the groups, and
# what the TUI remembers — and a later install.sh over it picks all of that up
# again. Removing it is a decision about data rather than about a program, so
# it is left to the person and to a command they type themselves.
#
# The conversations themselves are never touched either. They belong to claude
# and codex and live under their homes; magents only ever held ids pointing at
# them.
#
set -euo pipefail

PREFIX="${MAGENTS_PREFIX:-/usr/local}"
BIN="$PREFIX/bin"
SHARE="$PREFIX/share/magents"
UNIT_NAME="magents-daemon.service"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
CODEX_CONFIG="${CODEX_HOME:-$HOME/.codex}/config.toml"
SKILL_SRC="$SHARE/skills/magents"
SKILL_LINKS=(
	"${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/magents"
	"${CODEX_HOME:-$HOME/.codex}/skills/magents"
)

# the screens first, so a pane loses its socket before the thing on the other
# end of it goes away, and the daemon last — the same order install.sh uses
PROGRAMS=(magents magents-cli magents-daemon)

ASSUME_YES=0

step() { printf '\n\033[1m==>\033[0m %s\n' "$1"; }
info() { printf '    %s\n' "$1"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$1" >&2; }
die() { printf '\033[31m  ✗ %s\033[0m\n' "$1" >&2; exit 1; }

usage() {
	cat <<USAGE
usage: ./uninstall.sh [--yes]

  --yes      do not ask before removing

~/.magents — sessions, projects, groups, preferences — is always kept.

environment
  MAGENTS_PREFIX   where the binaries were installed; /usr/local by default
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

ask() {
	local prompt="$1" default="$2" reply
	[ -r /dev/tty ] || die "nothing to ask on — re-run with --yes if you mean it"
	read -r -p "$prompt" reply </dev/tty
	printf '%s' "${reply:-$default}"
}

# sudo only if the binaries are not ours to remove, decided now so the password
# prompt does not turn up in the middle
SUDO=""
if [ -e "$BIN/magents" ] && [ ! -w "$BIN" ]; then SUDO="sudo"; fi

# ─────────────────────────────────────────────────────── 1. say, and ask ──

step "magents ← $PREFIX"
[ -e "$BIN/magents" ] && info "binaries    $BIN/{magents,magents-cli,magents-daemon}"
[ -e "$SHARE" ] && info "migrations  $SHARE (the prefix's copy, not ~/.magents)"
for link in "${SKILL_LINKS[@]}"; do
	[ "$(readlink -- "$link" 2>/dev/null)" = "$SKILL_SRC" ] && info "skill       $link"
done
systemctl --user cat "$UNIT_NAME" >/dev/null 2>&1 && info "service     $UNIT_DIR/$UNIT_NAME"
[ -f "$CODEX_CONFIG" ] && grep -q '^# >>> magents >>>$' "$CODEX_CONFIG" &&
	info "codex       the magents block in $CODEX_CONFIG"
[ -n "$SUDO" ] && info "sudo        needed for $PREFIX"

printf '\n'
warn "every agent magents is running right now will be stopped"
info "the sessions survive — they are rows in ~/.magents, which stays — and"
info "the conversations belong to claude and codex, not to us."

if [ "$ASSUME_YES" -eq 0 ]; then
	printf '\n'
	case "$(ask "go ahead? [y/N] " n)" in
		y | Y | yes | YES) ;;
		*) die "nothing was changed" ;;
	esac
fi

# ────────────────────────────────────────────────────────────── 2. stop ──

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

# SIGTERM and then wait: the daemon's shutdown is the only thing that ends its
# agents on purpose. Ten seconds, then insist.
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

# ─────────────────────────────────────────────────────────── 3. service ──

step "removing the service"

systemctl --user disable "$UNIT_NAME" >/dev/null 2>&1 || true
rm -f "$UNIT_DIR/magents-daemon.service"
systemctl --user daemon-reload
systemctl --user reset-failed "$UNIT_NAME" >/dev/null 2>&1 || true

info "gone"

# ────────────────────────────────────────────────────────── 4. binaries ──

step "removing from $PREFIX"

for program in "${PROGRAMS[@]}"; do
	$SUDO rm -f "$BIN/$program"
done
# The migrations install.sh copied beside the binaries, under the *prefix* —
# /usr/local/share/magents by default. Not ~/.magents, despite the name: that
# one is the data and is never touched here. Only what install.sh put there,
# by name, and then the directories if that left them empty — a share
# directory with something else in it is somebody else's and stays.
$SUDO rm -f "${SHARE:?}"/migrations/*.sql "${SHARE:?}"/migrations/meta/*.json
$SUDO rm -f "${SHARE:?}"/skills/magents/SKILL.md
$SUDO rmdir "$SHARE/skills/magents" "$SHARE/skills" 2>/dev/null || true
$SUDO rmdir "$SHARE/migrations/meta" "$SHARE/migrations" "$SHARE" 2>/dev/null || true

info "$BIN/{magents,magents-cli,magents-daemon}"
[ -e "$SHARE" ] && warn "$SHARE was not empty and was left alone"

# ─────────────────────────────────────────────────────────────── 5. skill ──
# Only a link that points at our copy. Anything else by that name — a real
# directory, or a link somewhere else — is somebody's own and stays.

step "unlinking the skill"

for link in "${SKILL_LINKS[@]}"; do
	if [ "$(readlink -- "$link" 2>/dev/null)" = "$SKILL_SRC" ]; then
		rm -f -- "${link:?}"
		info "$link"
	elif [ -e "$link" ]; then
		warn "$link is not ours — left alone"
	fi
done

# ──────────────────────────────────────────────────────── 6. codex hook ──
# install.sh wrote its hooks between two marker lines, so those lines and
# what is between them are what comes out. The one case it could not write
# that way — a `Stop = [ … ]` already in the file, where ours went inside
# their array — is found by the command string and pointed at rather than
# edited: an edit inside somebody else's line is what install.sh verified
# byte by byte before writing, and this script has no such check.
#
# Codex's own record of having trusted the hook stays in `[hooks.state]`. It
# names a command that no longer exists and does nothing on its own.

step "taking the hook out of codex's config"

if [ -f "$CODEX_CONFIG" ] && grep -q '^# >>> magents >>>$' "$CODEX_CONFIG"; then
	cp "$CODEX_CONFIG" "$CODEX_CONFIG.before-magents-uninstall"
	awk '
		/^# >>> magents >>>$/ { inside = 1; next }
		/^# <<< magents <<<$/ { inside = 0; next }
		!inside { print }
	' "$CODEX_CONFIG.before-magents-uninstall" >"$CODEX_CONFIG.tmp"
	# the blank line install.sh put above its block, when it is now the last
	sed -i -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$CODEX_CONFIG.tmp"
	mv "$CODEX_CONFIG.tmp" "$CODEX_CONFIG"
	info "block removed — the file as it was is at $CODEX_CONFIG.before-magents-uninstall"
else
	info "no magents block in $CODEX_CONFIG"
fi

if [ -f "$CODEX_CONFIG" ] && grep -n 'magents-cli attention --hook' "$CODEX_CONFIG" >/dev/null; then
	warn "a magents hook is still written inline in $CODEX_CONFIG:"
	grep -n 'magents-cli attention --hook' "$CODEX_CONFIG" | sed 's/^/      /' >&2
	info "it was spliced into a Stop array you already had; take it out by hand."
fi

# ─────────────────────────────────────────────────────────────── 7. done ──

step "done"
info "~/.magents is untouched: sessions, projects, groups and preferences are"
info "all still there for the next install.sh. so are the conversations, under"
info "~/.claude and ~/.codex."
