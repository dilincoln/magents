# Sourced, not run: the environment every capture command shares.
#
# Everything runs inside the namespace `ns` builds, where the scratch tree
# /tmp/mgv-scratch/fakehome is mounted at /home/demo. So magents' own
# `~/.magents` (database, socket) lands in the scratch tree, and every path the
# TUI prints is an ordinary `/home/demo/code/…`. PATH puts the fake `claude`
# and `codex` first.

CAPTURE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_DIR="$(cd "$CAPTURE_DIR/../.." && pwd)"

export HOME=/home/demo
export USER=demo
export MAGENTS_HOME=/home/demo/.magents
export CODEX_HOME=/home/demo/.codex
export CLAUDE_CONFIG_DIR=/home/demo/.claude
export MAGENTS_CLI="$REPO_DIR/cli/index.ts"
export PATH="$CAPTURE_DIR/bin:/tmp/mgv-scratch/bin:/usr/local/bin:/usr/bin:/bin"
export COLORTERM=truecolor
export BUN_INSTALL_CACHE_DIR=/tmp/mgv-scratch/bun-cache
