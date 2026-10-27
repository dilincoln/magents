/**
 * A promise that only ever rejects, for racing against work that might hang.
 *
 * Both providers are asked by starting their CLI and waiting, and a CLI that
 * comes up but never answers would otherwise hold the request open forever —
 * the one failure mode with no error to catch.
 */
export const expire = (ms: number, what: string): Promise<never> =>
	new Promise((_, reject) =>
		setTimeout(() => reject(new Error(`${what} did not answer in time`)), ms),
	);
