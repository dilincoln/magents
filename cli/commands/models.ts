import { parseArgs } from "node:util";
import { listModels } from "../../client/list-models";
import { isProviderId, providerIds } from "../../daemon/providers/provider-id";
import { type Command, UsageError } from "../command";
import { table } from "../lib/columns";

/**
 * What a provider will run, and what each model's `--variant` can be.
 *
 * Here because `magents new -m` is otherwise a flag whose valid values live
 * nowhere a person can reach: the TUI shows them in a picker, and a CLI with no
 * equivalent would be asking people to guess or to go and read the adapter.
 *
 * It is the slow command and it is worth saying so — the daemon starts the
 * provider's own CLI to ask, which is why nothing else on this side validates a
 * model name in passing.
 */
export const modelsCommand: Command = {
	summary: "what a provider will run",
	usage: `magents models — what a provider will run

usage
  magents models <${providerIds.join("|")}> [--json]

notes
  the daemon starts the provider's CLI to find out, so this is not instant.
  a ✓ marks the provider's own pick, and a variant in [brackets] is the one it
  uses when none is chosen.`,

	async run(argv) {
		const { values, positionals } = parseArgs({
			args: argv,
			options: { json: { type: "boolean" } },
			allowPositionals: true,
			strict: true,
		});

		const provider = positionals[0];

		if (!provider) {
			throw new UsageError(`which provider? one of ${providerIds.join(", ")}`);
		}

		if (!isProviderId(provider)) {
			throw new UsageError(
				`${provider} is not a provider — expected ${providerIds.join(" or ")}`,
			);
		}

		const models = await listModels(provider);

		if (values.json) {
			console.log(JSON.stringify(models, null, 2));
			return;
		}

		console.log(
			table([
				["", "ID", "VARIANTS", "DESCRIPTION"],
				...models.map((model) => [
					model.recommended ? "✓" : "",
					model.id,
					model.variants
						.map((variant) =>
							variant.id === model.defaultVariant
								? `[${variant.id}]`
								: variant.id,
						)
						.join(" ") || "-",
					model.description,
				]),
			]),
		);
	},
};
