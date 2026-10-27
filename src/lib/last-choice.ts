import type { Model } from "../../daemon/providers/model";
import type { ProviderId } from "../../daemon/providers/provider-id";
import type { LiveSession } from "../../daemon/services/terminals";

/**
 * The provider, model and variant somebody last spawned on, anywhere.
 *
 * Read off the sessions themselves. This used to be the whole answer, on the
 * argument that a row in the database already outlives the window, is the
 * same in a second TUI, and is there tomorrow — and it is still the fallback
 * for exactly those reasons. What it cannot say is what was last spawned in
 * *one project*, because the newest row is wherever the newest work was;
 * that answer lives in `tui-preferences.ts` and is asked first. This is what
 * the panel opens on when that file has nothing for the project, and what it
 * offers on the other provider under `⌃p`.
 *
 * It comes out right for free in two places a stored copy would need code
 * for: a session opened by `magents new` in another terminal is the last
 * choice too, because it is a row like any other, and so is one opened by
 * somebody else's TUI.
 *
 * The list is the one the roster already has. `listSessions` orders by id, ids
 * are UUIDv7, and a UUIDv7 sorts by the millisecond it was minted — so the
 * answer is at the end and this is a walk backwards, not a sort.
 */
export interface Choice {
	readonly provider: ProviderId;
	readonly model: string;
	readonly variant: string | null;
}

/**
 * The most recent session that names a model, or the most recent on `provider`
 * when one is given. `null` when there has never been one.
 *
 * A row without a model is skipped rather than treated as a choice of none.
 * That is what an imported session is — `import-session.ts` writes `model:
 * null`, because bringing somebody else's conversation across is not a decision
 * about what to run it on — and letting one through would answer "what did you
 * last pick" with a session where nothing was picked.
 */
export function lastChoice(
	sessions: readonly LiveSession[],
	provider?: ProviderId,
): Choice | null {
	for (let at = sessions.length - 1; at >= 0; at--) {
		const session = sessions[at];

		if (!session?.model) continue;
		if (provider && session.provider !== provider) continue;

		return {
			provider: session.provider,
			model: session.model,
			variant: session.variant,
		};
	}

	return null;
}

/**
 * Where a freshly arrived model list should start, given what was last spawned.
 *
 * Its own function because it is three fallbacks rather than a lookup, and each
 * one is a decision:
 *
 * - **the remembered model is gone.** Providers retire models; a panel that
 *   opened on nothing, or on index 3 of a list that has changed under it, is
 *   worse than one that opens on the provider's recommendation.
 * - **the remembered variant is gone.** Same, one level down: `xhigh` on a
 *   model that stops at `high` is a setting that does not exist.
 * - **the model fell back, so the variant is dropped too.** A level belongs to
 *   the model it was picked on. Carrying `high` onto whatever the provider now
 *   recommends is half a memory, and it is the half nobody would notice was
 *   wrong.
 */
export function seedFrom(
	models: readonly Model[],
	remembered: Choice | null | undefined,
): { model: number; variant: number } {
	const wanted = models.findIndex((model) => model.id === remembered?.model);
	const recommended = models.findIndex((model) => model.recommended);
	const model = wanted !== -1 ? wanted : recommended === -1 ? 0 : recommended;

	return {
		model,
		variant:
			wanted !== -1
				? variantIndexOf(models[model], remembered?.variant)
				: defaultVariantOf(models[model]),
	};
}

/**
 * A named level on a model, falling back to where that model starts.
 *
 * The fallback is not an error path. A remembered `high` on a model that only
 * goes to `medium` is what an ordinary provider update looks like from here,
 * and the answer to it is the model's own default rather than a level it does
 * not have.
 */
function variantIndexOf(
	model: Model | undefined,
	wanted: string | null | undefined,
): number {
	const at =
		model?.variants.findIndex((variant) => variant.id === wanted) ?? -1;
	return at === -1 ? defaultVariantOf(model) : at;
}

/**
 * Where a model starts: the variant its adapter named.
 *
 * There is always one. A model whose level is unstated is a setting nobody can
 * see on the screen and nobody can reason about afterwards, so each adapter
 * commits to an answer — claude's is an assumption it documents, codex's comes
 * from the provider. Index 0 covers the two cases left: a model with no levels
 * at all, where nothing is selected because there is nothing to select, and a
 * default naming a level the model does not list, which is broken data rather
 * than a missing answer.
 */
function defaultVariantOf(model: Model | undefined): number {
	if (!model) return 0;

	const at = model.variants.findIndex(
		(variant) => variant.id === model.defaultVariant,
	);
	return at === -1 ? 0 : at;
}
