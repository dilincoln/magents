#!/usr/bin/env bash
# Builds the throwaway world the video is recorded in: a fake $HOME with four
# small git repositories, user-level skills for both providers, and a codex
# model cache. Nothing outside /tmp/mgv-scratch is touched.
#
# It refuses to run over an existing tree instead of clearing it. To start
# again, delete it by its full name first:
#
#   rm -rf /tmp/mgv-scratch
set -euo pipefail

if [ -e /tmp/mgv-scratch ]; then
	echo "/tmp/mgv-scratch already exists — remove it first (see the header)" >&2
	exit 1
fi

mkdir -p /tmp/mgv-scratch/fakehome/code /tmp/mgv-scratch/fakehome/.magents

commit() { # repo, date, message
	git -C "/tmp/mgv-scratch/fakehome/code/$1" add -A
	GIT_AUTHOR_DATE="$2" GIT_COMMITTER_DATE="$2" \
		git -C "/tmp/mgv-scratch/fakehome/code/$1" \
		-c user.name="Demo" -c user.email="demo@example.com" \
		commit -q -m "$3"
}

repo() { # name, files…
	local name=$1
	shift
	git init -q -b main "/tmp/mgv-scratch/fakehome/code/$name"
	for file in "$@"; do
		mkdir -p "$(dirname "/tmp/mgv-scratch/fakehome/code/$name/$file")"
		# valid files of their kind: bun reads package.json in any directory it
		# runs from, and a broken one is an error printed into the agent's pane
		case "$file" in
		*.json) printf '{ "name": "%s", "private": true, "type": "module" }\n' "$name" ;;
		*.toml | *.tf) printf '# %s\n' "$file" ;;
		*.sql) printf -- '-- %s\n' "$file" ;;
		*) printf '// %s\n' "$file" ;;
		esac >"/tmp/mgv-scratch/fakehome/code/$name/$file"
	done
	printf '# %s\n' "$name" >"/tmp/mgv-scratch/fakehome/code/$name/README.md"
	commit "$name" "2026-10-20T10:00:00" "initial commit"
}

skill() { # dir, name, description
	mkdir -p "$1/$2"
	printf -- '---\nname: %s\ndescription: %s\n---\n\n%s\n' "$2" "$3" "$3" >"$1/$2/SKILL.md"
}

repo atlas-api src/http/server.ts src/http/routes/users.ts db/schema.sql package.json
repo orbit-web app/settings/page.tsx tests/e2e/checkout.spec.ts package.json
repo ledger-core src/main.rs src/recon.rs Cargo.toml
repo infra envs/staging/main.tf envs/prod/main.tf

# project-level skills, the ones `/` finds in the prompt box
skill /tmp/mgv-scratch/fakehome/code/atlas-api/.claude/skills write-migration "Write a reversible SQL migration and its test"
skill /tmp/mgv-scratch/fakehome/code/atlas-api/.claude/skills api-review "Review a route for auth, validation and error shape"
skill /tmp/mgv-scratch/fakehome/code/orbit-web/.claude/skills e2e-debug "Reproduce and fix a flaky Playwright test"

# user-level skills, for both providers
skill /tmp/mgv-scratch/fakehome/.claude/skills changelog "Draft a changelog entry from the branch's commits"
skill /tmp/mgv-scratch/fakehome/.claude/skills open-pr "Push the branch and open a pull request"
skill /tmp/mgv-scratch/fakehome/.claude/skills jira-ticket "Pull a Jira ticket's description into the conversation"
skill /tmp/mgv-scratch/fakehome/.codex/skills test-plan "Write a test plan before touching the code"

cat >/tmp/mgv-scratch/fakehome/.codex/models_cache.json <<'JSON'
{
  "models": [
    { "slug": "gpt-5.5-codex", "display_name": "gpt-5.5-codex", "description": "Optimized for agentic coding", "visibility": "list", "priority": 1, "default_reasoning_level": "high",
      "supported_reasoning_levels": [ { "effort": "low", "description": "Fast responses with lighter reasoning" }, { "effort": "medium", "description": "Balances speed and depth" }, { "effort": "high", "description": "Maximizes reasoning depth" }, { "effort": "xhigh", "description": "Extra high reasoning for the hardest problems" } ] },
    { "slug": "gpt-5.5", "display_name": "gpt-5.5", "description": "Broad world knowledge with strong reasoning", "visibility": "list", "priority": 2, "default_reasoning_level": "medium",
      "supported_reasoning_levels": [ { "effort": "low", "description": "Fast responses" }, { "effort": "medium", "description": "Balanced" }, { "effort": "high", "description": "Deep reasoning" } ] },
    { "slug": "gpt-5.5-mini", "display_name": "gpt-5.5-mini", "description": "Cheaper and faster, for small tasks", "visibility": "list", "priority": 3, "default_reasoning_level": "medium",
      "supported_reasoning_levels": [ { "effort": "low", "description": "Fast responses" }, { "effort": "medium", "description": "Balanced" } ] }
  ]
}
JSON

echo "mock world ready in /tmp/mgv-scratch"
