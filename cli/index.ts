#!/usr/bin/env bun

/**
 * The command line onto the same daemon the TUI talks to.
 *
 * There is no second door. Every command here goes through `client/`, which is
 * the one module that knows the socket path and the routes — the same functions
 * the TUI's queries call, so a route that changes shape breaks both at compile
 * time instead of leaving one of them quietly wrong. Nothing in here reads the
 * database, and that is not a style preference: the daemon holds the only
 * writer, and a CLI that opened the file beside it would be the second one.
 *
 * What that buys is the answer to "how does the TUI find out". It does not have
 * to be told. A session opened here is a row the daemon owns a moment later,
 * and the TUI's heartbeat is already asking for the session and project lists
 * every beat and a half — see `use-daemon-heartbeat.ts`, which now refetches
 * both for exactly this reason. There is no message from this process to that
 * one, because there is nothing this process knows that the daemon does not.
 *
 * Three exit statuses, and the middle one is the point: 0 for done, 2 for a
 * command that was typed wrong, 1 for one that was typed right and refused. A
 * script can tell its own bug from the daemon's answer without reading English.
 */

import { type Command, UsageError } from "./command";
import { attentionCommand } from "./commands/attention";
import { groupsCommand } from "./commands/groups";
import { hooksCommand } from "./commands/hooks";
import { modelsCommand } from "./commands/models";
import { moveCommand } from "./commands/move";
import { newCommand } from "./commands/new";
import { projectsCommand } from "./commands/projects";
import { renameCommand } from "./commands/rename";
import { sessionsCommand } from "./commands/sessions";

const COMMANDS: Record<string, Command> = {
	projects: projectsCommand,
	groups: groupsCommand,
	sessions: sessionsCommand,
	new: newCommand,
	rename: renameCommand,
	move: moveCommand,
	attention: attentionCommand,
	models: modelsCommand,
	hooks: hooksCommand,
};

const HELP = `magents — provider-agnostic control plane for coding agents

usage
  magents <command> [flags]

commands
${Object.entries(COMMANDS)
	.map(([name, command]) => `  ${name.padEnd(11)}${command.summary}`)
	.join("\n")}

flags
  -h, --help    this, or a command's own when it follows one

the daemon answers on a unix socket in ~/.magents and holds every agent's
terminal; start it with \`bun run daemon\` if a command says it is not connected.`;

const asksForHelp = (argv: readonly string[]): boolean =>
	argv.includes("--help") || argv.includes("-h");

async function main(): Promise<number> {
	const [name, ...rest] = Bun.argv.slice(2);

	if (!name || asksForHelp([name])) {
		console.log(HELP);
		return 0;
	}

	const command = COMMANDS[name];

	if (!command) {
		console.error(`magents: no command \`${name}\``);
		console.error(`  try one of ${Object.keys(COMMANDS).join(", ")}`);
		return 2;
	}

	// Answered before the flags are parsed, so `magents new --help` works without
	// also satisfying `new`'s required ones — asking what a command takes is the
	// thing you do when you do not know what it takes.
	if (asksForHelp(rest)) {
		console.log(command.usage);
		return 0;
	}

	try {
		await command.run(rest);
		return 0;
	} catch (error) {
		// `parseArgs` refuses unknown and malformed flags with its own sentence,
		// which is a better one than we would write; it is a usage error either
		// way, so it is shown with the usage.
		const usage =
			error instanceof UsageError ||
			(error instanceof TypeError && String(error.message).includes("option"));

		console.error(
			`magents: ${error instanceof Error ? error.message : String(error)}`,
		);

		if (usage) {
			console.error("");
			console.error(command.usage);
			return 2;
		}

		return 1;
	}
}

// `exitCode` rather than `exit`, so whatever was written to a pipe is flushed
// before the process ends.
process.exitCode = await main();
