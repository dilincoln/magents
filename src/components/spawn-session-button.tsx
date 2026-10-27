import type { Project } from "../../daemon/db/schema";
import { openSpawnSession } from "../actions/open-spawn-session";
import { theme } from "../lib/theme";
import { PressableText } from "./ui/pressable";

/**
 * The row under a project that starts one. The mouse's way to what `⌃n` does.
 *
 * Not a row the cursor lands on. It is an affordance, like `+ add project` at
 * the foot of the sidebar — the cursor walks projects and agents, which are
 * things, and a button is not one of them. Which is exactly why it hovers: with
 * no cursor to land on it, the pointer is the only thing that can say it is a
 * button and not a caption.
 */
export function SpawnSessionButton({ project }: { project: Project }) {
	return (
		<PressableText
			onPress={() => openSpawnSession(project)}
			style={{ width: "100%", flexShrink: 0 }}
		>
			<span style={{ fg: theme.accent }}>{"  + "}</span>
			<span style={{ fg: theme.faint }}>spawn session</span>
		</PressableText>
	);
}
