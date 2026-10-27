#!/usr/bin/env bash
# Fills the mock daemon with the roster the video shows. Run once, after
# setup-mock.sh and with the daemon up. Every agent here is fake-agent.ts.
set -euo pipefail
cd "$(dirname "$0")"

C=/home/demo/code

new() { ./mg new "$@" >/dev/null; }

# registered first and in this order, because the roster lists projects oldest first
for project in atlas-api orbit-web ledger-core infra; do
	curl -sf --unix-socket /home/demo/.magents/daemon.sock \
		-H 'content-type: application/json' -d "{\"path\":\"$C/$project\"}" \
		http://magents/projects >/dev/null
done

# atlas-api — a backend with a real workflow: Active, Review, and a Done that sleeps
./mg groups add Active --project $C/atlas-api --default
./mg groups add Review --project $C/atlas-api
./mg groups add Done --project $C/atlas-api --hibernates

new -p claude -m opus --variant high --project $C/atlas-api -g Active \
	-n "JIRA-2041 rate-limit the public API" --prompt "rate-limit the public API per API key (JIRA-2041)"
new -p codex -m gpt-5.5-codex --variant high --project $C/atlas-api -g Active \
	-n "migrate users table to v2 schema" --prompt "migrate the users table to the v2 schema"
new -p claude -m sonnet --variant medium --project $C/atlas-api -g Review \
	-n "review the API surface" --prompt "review the API surface before the v2 launch"
new -p claude -m haiku --variant low --project $C/atlas-api -g Done \
	-n "add OpenAPI docs" --prompt "generate OpenAPI docs for the users routes"

# orbit-web — the frontend
./mg groups add "waiting on CI" --project $C/orbit-web
new -p codex -m gpt-5.5-codex --variant high --project $C/orbit-web --no-group \
	-n "fix flaky checkout e2e tests" --prompt "fix the flaky checkout e2e tests"
new -p claude -m opus --variant medium --project $C/orbit-web -g "waiting on CI" \
	-n "dark mode for settings page" --prompt "add dark mode to the settings page"

# ledger-core and infra, one each
new -p claude -m opus --variant max --project $C/ledger-core \
	-n "JIRA-1979 reconcile ledger drift" --prompt "reconcile the ledger drift from JIRA-1979"
new -p codex -m gpt-5.5 --variant medium --project $C/infra \
	-n "terraform plan for staging" --prompt "run terraform plan for staging and explain it"

./mg sessions
