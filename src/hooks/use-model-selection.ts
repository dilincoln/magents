import { useKeyboard } from "@opentui/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { Model, Variant } from "../../daemon/providers/model";
import type { ProviderId } from "../../daemon/providers/provider-id";
import { type Choice, seedFrom } from "../lib/last-choice";
import { modelsQuery } from "../queries/models-query";

const NONE: Model[] = [];

export interface ModelSelection {
	model: Model | undefined;
	variant: Variant | undefined;
	/** how many there are to cycle through — what says whether a key is worth showing */
	models: number;
	variants: number;
	pending: boolean;
	/** the provider's complaint, when there was one */
	error: Error | null;
	/**
	 * One step forward. Returns whether there was anywhere to go, which is what
	 * lets the key handler leave a useless `⌃o` to whoever else might want it.
	 *
	 * Handed out rather than kept private because the keys are not the only way
	 * in: the labels on the row are click targets, and a click and a keystroke
	 * that ran different code would drift apart the first time one of them
	 * learned something the other did not.
	 */
	cycleModel: () => boolean;
	cycleVariant: () => boolean;
}

/**
 * Which model an agent will be spawned on, and the two keys that change it.
 *
 * Chords, not letters. Every bare key in this panel belongs to the box being
 * typed in, and a picker that steals `m` is a picker that cannot be described
 * in a prompt. `⌃o` and `⌃e` are safe mid-word and go through the suggestion
 * picker untouched — it only ever wants arrows, `tab`, `return` and `esc`.
 *
 * `preventDefault` is what keeps the textarea from also seeing them, the same
 * way `useSkillSuggestions` takes its keys.
 *
 * `remembered` is where the panel starts when there is something to go on — the
 * last model actually spawned on this provider, from `lastChoice`. It is a
 * suggestion and not an instruction: a model that has since left the provider's
 * list, or a variant that model no longer offers, falls through to the same
 * defaults as a first run rather than pinning the selection to something that
 * is not there.
 */
export function useModelSelection(
	provider: ProviderId,
	remembered?: Choice | null,
): ModelSelection {
	const { data, isPending, error } = useQuery(modelsQuery(provider));
	const models = data ?? NONE;

	const [modelIndex, setModelIndex] = useState(0);
	const [variantIndex, setVariantIndex] = useState(0);

	/*
	 * The list arrives a render or two after the panel does, so the provider's
	 * own pick cannot be an initial `useState` — it is applied the first time a
	 * list actually shows up. Keyed by provider rather than by a boolean: a
	 * refetch that returned the same models must not move a selection the user
	 * already made, but switching provider is a different list entirely, and an
	 * index left over from the old one points at whatever now occupies that slot.
	 */
	const [seededFor, setSeededFor] = useState<ProviderId | null>(null);
	if (seededFor !== provider && models.length > 0) {
		setSeededFor(provider);

		const seed = seedFrom(models, remembered);
		setModelIndex(seed.model);
		setVariantIndex(seed.variant);
	}

	const model = models[modelIndex];
	const variants = model?.variants ?? [];
	const variant = variants[variantIndex];

	const cycleModel = (): boolean => {
		if (models.length === 0) return false;

		const next = (modelIndex + 1) % models.length;
		setModelIndex(next);
		// the new model's own default, not the position the old one was on:
		// `xhigh` on a model whose list stops at `high` is a setting that does not
		// exist, and index 3 means something different on every model
		setVariantIndex(defaultVariantOf(models[next]));
		return true;
	};

	const cycleVariant = (): boolean => {
		if (variants.length === 0) return false;

		setVariantIndex((current) => (current + 1) % variants.length);
		return true;
	};

	useKeyboard((key) => {
		if (!key.ctrl) return;

		const moved =
			key.name === "o"
				? cycleModel()
				: key.name === "e"
					? cycleVariant()
					: false;

		// a key that changed nothing was never ours to take
		if (!moved) return;

		key.preventDefault();
		key.stopPropagation();
	});

	return {
		model,
		variant,
		models: models.length,
		variants: variants.length,
		pending: isPending,
		error: error as Error | null,
		cycleModel,
		cycleVariant,
	};
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
