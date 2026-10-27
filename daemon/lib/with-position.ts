/**
 * Writes a row with a freshly generated sort key, and again with another one
 * if the database says that key is taken.
 *
 * The retry is fraci's contract rather than defensive coding. Two writers
 * appending to the same project would compute the same "after the last one"
 * key from the same snapshot, and the unique index is what makes the second
 * one wrong rather than silently equal; the generator answers a conflict with
 * a different key drawn from the same interval, so the loser lands beside the
 * winner instead of on top of it. One daemon means this is close to never, and
 * "close to never" is exactly the kind of thing worth writing down once.
 *
 * Only a conflict on the key retries. Everything else — a title already taken,
 * a foreign key with nothing behind it — is the caller's business and goes
 * straight up.
 */
export const withPosition = <FI, T>(
	keys: Generator<FI, never, unknown>,
	write: (position: FI) => T,
): T => {
	for (const position of keys) {
		try {
			return write(position);
		} catch (cause) {
			if (taken(cause)) continue;
			throw cause;
		}
	}

	// `keys` is a `Generator<_, never>` — it throws `MAX_RETRIES_EXCEEDED`
	// rather than running out — so the loop is left by returning or by
	// throwing, never by finishing. TypeScript cannot see that, and a function
	// has to end somewhere.
	throw new Error("unreachable: the key generator never completes");
};

/**
 * Whether SQLite refused the write because the sort key was taken.
 *
 * Matched on the column rather than on the message alone: a group insert can
 * also trip `groups_title_per_project`, which is a person picking a name they
 * already used, and retrying that one would spin until the retries ran out and
 * then report the wrong thing.
 */
const taken = (cause: unknown): boolean =>
	cause instanceof Error &&
	cause.message.includes("UNIQUE constraint failed") &&
	cause.message.includes("groups.position");
