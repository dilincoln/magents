import { openImportSession } from "../actions/open-import-session";
import { theme } from "../lib/theme";
import { PressableText } from "./ui/pressable";

/**
 * The mouse's way to the same thing `⌃g` does.
 *
 * Under `+ add project` and not under any one project, which is the same claim
 * its shortcut makes: what comes in belongs to the folder the conversation ran
 * in, and that folder is read off the transcript rather than chosen here.
 *
 * `↓` rather than `+`, because this one does not make anything. The two rows
 * are next to each other and a reader should be able to tell at a glance which
 * of them creates and which of them collects.
 */
export function ImportSessionButton() {
	return (
		<PressableText
			onPress={openImportSession}
			style={{ width: "100%", flexShrink: 0 }}
		>
			<span style={{ fg: theme.violet }}>↓ </span>
			<span style={{ fg: theme.muted }}>import session</span>
		</PressableText>
	);
}
