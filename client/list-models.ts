import type { Model } from "../daemon/providers/model";
import type { ProviderId } from "../daemon/providers/provider-id";
import { request } from "./request";

/** What a provider will run. Asked live — the daemon starts its CLI to find out. */
export const listModels = (provider: ProviderId): Promise<Model[]> =>
	request(`/providers/${provider}/models`);
