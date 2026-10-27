import { parseArgs } from "node:util";
import { renameSession } from "../../client/rename-session";
import { type Command, UsageError } from "../command";
import { short } from "../lib/columns";
import { resolveSession } from "../lib/resolve-session";

/**
 * A different name for a session.
 *
 * Two positionals rather than flags, because both are required and there is no
 * third thing this could mean — `magents rename api "fix the parser"` reads as
 * the sentence it is. The name is taken whole and clamped daemon-side by the
 * same `sessionTitle` the spawn panel's prompt goes through, so a paragraph
 * pasted in here becomes one line there rather than a paragraph stored forever.
 *
 * The session is looked up by id, by the front of one, or by its current name,
 * which is the one somebody reading `magents sessions` actually has.
 */
export const renameCommand: Command = {
	summary: "give a session a different name",
	usage: `magents rename — give a session a different name

usage
  magents rename <session> <name>

arguments
  <session>   an id, the front of one, or the session's current name
  <name>      what to call it instead

flags
      --json  the renamed row as the daemon's own JSON`,

	async run(argv) {
		const { values, positionals } = parseArgs({
			args: argv,
			options: { json: { type: "boolean" } },
			allowPositionals: true,
			strict: true,
		});

		const [ref, ...rest] = positionals;
		const name = rest.join(" ").trim();

		if (!ref) throw new UsageError("which session? give an id or a name");
		if (!name) throw new UsageError("what should it be called?");

		const session = await resolveSession(ref);
		const renamed = await renameSession({ id: session.id, title: name });

		if (values.json) {
			console.log(JSON.stringify(renamed, null, 2));
			return;
		}

		console.log(`${short(renamed.id)}  ${renamed.title}`);
	},
};
