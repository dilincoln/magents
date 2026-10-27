/**
 * A model an agent can be run on, in no provider's vocabulary.
 *
 * The shape is deliberately the smaller half of what any one CLI reports: what
 * two providers both have is a name, a sentence, and some number of ways to
 * dial how hard it thinks. Codex calls that last one reasoning effort; the word
 * does not travel, so it is a `variant` here.
 */
export interface Model {
	id: string;
	/** what to show — a provider's own display name when it has one */
	label: string;
	description: string;
	/**
	 * The ways this model can be run, empty when it has none. Per model, not per
	 * provider: codex's `gpt-5.6-luna` stops at `max` where its siblings go on to
	 * `ultra`, and the older models stop two rungs earlier still — a list fixed
	 * at the provider would offer settings that do not exist.
	 */
	variants: Variant[];
	/** the variant used when none is chosen, if the provider names one */
	defaultVariant: string | null;
	/** the provider's own pick — what its CLI would use unprompted */
	recommended: boolean;
}

export interface Variant {
	id: string;
	label: string;
	description: string;
}
