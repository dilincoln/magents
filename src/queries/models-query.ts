import { queryOptions } from "@tanstack/react-query";
import { listModels } from "../../client/list-models";
import type { ProviderId } from "../../daemon/providers/provider-id";

/**
 * How long an answer is trusted. Generous, because the cost is not a request —
 * the daemon spawns the provider's CLI and shakes hands with it to answer, and
 * the list changes when someone upgrades that CLI, which is not something that
 * happens while a picker is open.
 */
const FRESH_FOR = 5 * 60 * 1000;

/**
 * The models a provider offers, keyed by provider so claude and codex do not
 * share a list once claude has an adapter.
 */
export const modelsQuery = (provider: ProviderId) =>
	queryOptions({
		queryKey: ["models", provider],
		queryFn: () => listModels(provider),
		staleTime: FRESH_FOR,
	});
