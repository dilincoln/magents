import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ProviderId } from "../../daemon/providers/provider-id";
import type { LiveSession } from "../../daemon/services/terminals";
import { type Choice, lastChoice } from "../lib/last-choice";
import { rememberedModel } from "../lib/tui-preferences";
import { sessionsQuery } from "../queries/sessions-query";

const NONE: LiveSession[] = [];

export interface RememberedSpawn {
	/** which provider the panel should open on */
	readonly provider: ProviderId;
	/** what was last run on a given provider, for when the panel moves off it */
	readonly on: (provider: ProviderId) => Choice | null;
}

/**
 * What the spawn panel should be showing before anybody touches it.
 *
 * The project's own last spawn first, from `~/.magents/tui.json` — see
 * `tui-preferences.ts` for why that is a file and why it is per project. It
 * is read once, when the panel opens: a preference that changed under an
 * open panel would move a selection somebody was already looking at.
 *
 * The sessions second, for a project that has never been spawned into from
 * this screen, and for `⌃p` onto the other provider: the preference names one
 * provider's model, and the last session on the other is still the best
 * guess for what to offer there. A single remembered triple would otherwise
 * have had to choose between forgetting and offering codex's model on claude.
 *
 * The query is the roster's own, already fetched and already in the cache by
 * the time a panel can be opened — there is no project to spawn into until the
 * roster has drawn one. So this is a read, not a request.
 */
export function useRememberedSpawn(
	projectPath: string,
	fallback: ProviderId,
): RememberedSpawn {
	const { data } = useQuery(sessionsQuery);
	const sessions = data ?? NONE;
	const [preferred] = useState(() => rememberedModel(projectPath));

	return {
		provider: preferred?.provider ?? lastChoice(sessions)?.provider ?? fallback,
		on: (provider) =>
			preferred?.provider === provider
				? preferred
				: lastChoice(sessions, provider),
	};
}
