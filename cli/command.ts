/**
 * What a command is, so the entry point can hold a table of them and nothing
 * more. Each one owns its own flags, its own help and its own output — the same
 * arrangement the daemon's routes have, and for the same reason: a dispatcher
 * that knows what any single command takes is a dispatcher that has to be
 * edited to add one.
 */
export interface Command {
	/** one line, listed under `magents --help` */
	summary: string;
	/** the whole block, printed by `magents <name> --help` */
	usage: string;
	run(argv: string[]): Promise<void>;
}

/**
 * The caller typed something this cannot act on — an unknown flag, a missing
 * argument, a provider that is not one.
 *
 * Told apart from every other failure because it is the only one whose answer
 * is the usage text, and because it deserves its own exit status: a script that
 * called this wrongly wants to know that from a shell test, not by reading the
 * message.
 */
export class UsageError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UsageError";
	}
}
