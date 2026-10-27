import { type ProviderId, providers } from "../../lib/agents";

/**
 * The provider mark: a diamond in the provider's brand colour.
 *
 * Filled or hollow says whether there is something behind it. On a session row
 * that is literal — a process, running right now — and it is worth a glyph
 * rather than a word because it changes what the row means: a filled one picks
 * an agent back up mid-sentence, a hollow one starts a resume. Everywhere else
 * the mark is only a mark, so filled is the default.
 */
export function ProviderMark({
	provider,
	live = true,
}: {
	provider: ProviderId;
	live?: boolean;
}) {
	return (
		<span style={{ fg: providers[provider].accent }}>{live ? "◆" : "◇"}</span>
	);
}
