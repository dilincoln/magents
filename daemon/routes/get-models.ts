import { Effect } from "effect";
import { adapters } from "../providers/adapters";
import { isProviderId } from "../providers/provider-id";

/**
 * `GET /providers/:id/models` — what that provider will run, asked live.
 *
 * Three failures, told apart because the caller can act on the difference: a
 * provider that does not exist is a typo, one with no adapter is a feature that
 * has not landed, and one whose CLI refused is a machine to fix. Only the last
 * is worth a retry.
 */
export const getModels = (provider: string): Effect.Effect<Response> => {
	if (!isProviderId(provider)) {
		return Effect.succeed(
			Response.json(
				{ error: `no such provider: ${provider}` },
				{ status: 404 },
			),
		);
	}

	const adapter = adapters[provider];

	if (!adapter) {
		return Effect.succeed(
			Response.json(
				{ error: `${provider} cannot list its models yet` },
				{ status: 501 },
			),
		);
	}

	return adapter.listModels.pipe(
		Effect.map((models) => Response.json(models)),
		// 502, not 500: the daemon is fine, the thing behind it is not, and the
		// provider's own complaint is what goes on the screen
		Effect.catchTag("ProviderError", (error) =>
			Effect.succeed(Response.json({ error: error.reason }, { status: 502 })),
		),
	);
};
