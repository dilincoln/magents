/**
 * One project per directory, so `~/code/magents/` and `~/code/magents` have to
 * reach the same row rather than two.
 */
export const normalizePath = (path: string): string => {
	const trimmed = path.trim().replace(/\/+$/, "");
	return trimmed === "" ? "/" : trimmed;
};
