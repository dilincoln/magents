/**
 * Who can run an agent. The daemon owns this list rather than the screen: it is
 * what a route has to validate before it looks anything up, and a second copy
 * on the client would be the one that goes stale.
 */
export type ProviderId = "claude" | "codex";

export const providerIds: ProviderId[] = ["claude", "codex"];

/** For turning a path segment into a `ProviderId`, or refusing it. */
export const isProviderId = (value: string): value is ProviderId =>
	(providerIds as string[]).includes(value);
