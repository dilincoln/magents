import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import {
	type ProviderId,
	providerIds,
} from "../../daemon/providers/provider-id";

export interface ProviderChoice {
	provider: ProviderId;
	/** how many there are to cycle through — one provider needs no key */
	providers: number;
	cycle: () => boolean;
}

/**
 * Which provider an agent will be spawned on.
 *
 * Its own hook rather than a third field on the model selection: the provider
 * is the question *above* the model, and `useModelSelection` is a function of
 * whatever this answers. Kept apart, that dependency runs one way — switching
 * provider re-seeds the model list, and nothing about picking a model can reach
 * back up here.
 *
 * `⌃p` for the provider, next to `⌃o` for the model and `⌃e` for the variant.
 * A chord, like its neighbours, so it survives being pressed mid-word in the
 * box below.
 */
export function useProviderChoice(initial: ProviderId): ProviderChoice {
	const [index, setIndex] = useState(() =>
		Math.max(0, providerIds.indexOf(initial)),
	);

	const cycle = (): boolean => {
		if (providerIds.length < 2) return false;

		setIndex((current) => (current + 1) % providerIds.length);
		return true;
	};

	useKeyboard((key) => {
		if (!key.ctrl || key.name !== "p") return;
		if (!cycle()) return;

		key.preventDefault();
		key.stopPropagation();
	});

	return {
		provider: providerIds[index] ?? initial,
		providers: providerIds.length,
		cycle,
	};
}
