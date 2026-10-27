/**
 * What a provider needs in order to open a session, in no provider's words.
 */
export interface SessionSpec {
	/**
	 * Our row's id. Offered as the provider's own to any provider that will take
	 * one — a single id for both sides is the whole reason resume is simple.
	 */
	id: string;
	prompt: string;
	model: string | null;
	variant: string | null;
	/** the project directory the CLI is started in */
	cwd: string;
}

/** A session about to exist, and the command that puts a terminal on it. */
export interface Launch {
	/**
	 * The provider's handle, which is what `resume` will be given — or null when
	 * the provider will not say yet.
	 *
	 * Claude takes the id we offer and the two agree from the start. Codex mints
	 * its own and does not save the session until a run has actually happened,
	 * so at this point there is nothing to record: a handle written down before
	 * the session is saved is an id that `resume` refuses.
	 */
	externalId: string | null;
	argv: string[];
}

/**
 * A conversation that already exists, found by reading what the provider wrote.
 *
 * The counterpart to {@link Launch}: that one describes a session about to be,
 * this one a session that has been — started in a terminal somewhere, by
 * somebody who was not us, and now being brought in by its handle.
 *
 * `cwd` is the important field and it is not the caller's to supply. A resume
 * finds its conversation by looking in the directory it was held in, so the
 * directory has to come from the transcript rather than from whichever project
 * happened to be selected when the id was pasted.
 */
export interface FoundSession {
	/** the handle it was found by, echoed back so the caller has one shape to store */
	externalId: string;
	/** where it ran, read off the record rather than guessed from a filename */
	cwd: string;
	/**
	 * What to call it in a list, when the transcript says something worth using.
	 * Null when it does not — the caller has a fallback, and inventing a sentence
	 * here would put words in the provider's mouth.
	 */
	title: string | null;
}
