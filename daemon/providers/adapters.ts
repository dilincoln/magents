import { claudeAdapter } from "./claude";
import { codexAdapter } from "./codex";
import type { ProviderAdapter } from "./provider-adapter";
import type { ProviderId } from "./provider-id";

/**
 * Who the daemon knows how to ask.
 *
 * Both providers now, which is what the `Partial` was holding the door open
 * for. It stays partial rather than becoming a total `Record`: a third provider
 * arrives as a name on the screen before it arrives as an adapter, and a
 * missing entry answering 501 with a sentence is better than a stub answering
 * an empty list — an empty list is indistinguishable from a provider with
 * nothing installed.
 */
export const adapters: Partial<Record<ProviderId, ProviderAdapter>> = {
	claude: claudeAdapter,
	codex: codexAdapter,
};
