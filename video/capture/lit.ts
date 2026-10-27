#!/usr/bin/env bun
/**
 * When does a roster row light up? Prints, for each title given, the times in
 * a take at which that row's background changes, and the row it is on.
 *
 *   bun capture/lit.ts attention "fix flaky" "JIRA-1979" "review the API"
 */
import { join } from "node:path";

const [name, ...titles] = process.argv.slice(2);
const source = await Bun.file(join(import.meta.dir, "..", "takes", `${name}.js`)).text();
const take = JSON.parse(source.slice(source.indexOf("] = ") + 4, source.lastIndexOf(";")));

const plain = (html: string) => html.replace(/<[^>]*>/g, "");

for (const title of titles) {
	let last = "";
	for (const frame of take.frames) {
		const row = frame.rows.findIndex((id: number) => plain(take.rowsDict[id]).slice(0, 30).includes(title));
		if (row < 0) continue;
		const html = take.rowsDict[frame.rows[row]] as string;
		// the background behind the title's text, i.e. the row's own box
		const at = html.indexOf(title.slice(0, 4));
		const before = html.slice(0, at);
		const bg = [...before.matchAll(/background:(#[0-9a-f]{6})/g)].at(-1)?.[1] ?? "?";
		const kind = bg === "#0d1020" ? "plain" : bg === "#2f3d6b" ? "cursor" : "lit";
		const state = `${kind}@${row}`;
		if (state !== last) {
			console.log(`${title.padEnd(18)} t=${frame.t.toFixed(3)}  row ${row}  bg ${bg}`);
			last = state;
		}
	}
}
