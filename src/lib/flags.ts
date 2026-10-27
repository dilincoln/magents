/** Process-level switches, read once at startup. */
export const flags = {
	/** --no-pulse pins the wordmark to its resting state */
	pulse: !process.argv.includes("--no-pulse"),
	/** --no-bell keeps the terminal quiet when a session starts wanting you */
	bell: !process.argv.includes("--no-bell"),
} as const;
