/**
 * The screen's data model. Nothing here runs anything yet — it is the shape an
 * agent has, kept deliberately free of any single provider's vocabulary.
 */

// Re-exported, not redeclared: the daemon validates provider ids on the way in
// and a second copy here would be the one that drifts.
export type { ProviderId } from "../../daemon/providers/provider-id";

import type { ProviderId } from "../../daemon/providers/provider-id";

export interface Provider {
	id: ProviderId;
	label: string;
	/** brand color, used for the provider badge */
	accent: string;
	/** short subtitle shown next to the agent name */
	runtime: string;
}

export const providers: Record<ProviderId, Provider> = {
	claude: {
		id: "claude",
		label: "claude",
		accent: "#d97757",
		runtime: "claude code · cli",
	},
	codex: {
		id: "codex",
		label: "codex",
		accent: "#10a37f",
		runtime: "openai codex · cli",
	},
};

/** Where user-level agents live. The only home an agent has, for now. */
export const USER_AGENTS_PATH = "~/.magents/agents";

export type Scope = "project" | "user";

export interface Agent {
	id: string;
	name: string;
	description: string;
	provider: ProviderId;
	model: string;
	tools: string[];
	/** the project this agent belongs to, or null for a user-level agent */
	project: string | null;
	/** screen-only for now: this version never starts a process */
	state: "ready" | "draft";
}

/** Scope is not stored: it is what having a project means. */
export function scopeOf(agent: Agent): Scope {
	return agent.project ? "project" : "user";
}

/**
 * Nothing produces one yet.
 *
 * The type is what an agent will be when `.claude/agents` is read and a row
 * here can start something; the list is empty because inventing entries to look
 * at was the old way of finding that out, and sessions are real now.
 */
export const seedAgents: Agent[] = [];
