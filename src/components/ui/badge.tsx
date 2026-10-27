import { type ProviderId, providers } from "../../lib/agents";
import { ProviderMark } from "./provider-mark";

/** The provider mark plus its name, for a row wide enough to spell it out. */
export function Badge({ provider }: { provider: ProviderId }) {
	return (
		<>
			<ProviderMark provider={provider} />
			<span style={{ fg: providers[provider].accent }}>
				{` ${providers[provider].label}`}
			</span>
		</>
	);
}
