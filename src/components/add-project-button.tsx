import { openAddProject } from "../actions/open-add-project";
import { theme } from "../lib/theme";
import { PressableText } from "./ui/pressable";

/** The mouse's way to the same thing `n` does. */
export function AddProjectButton() {
	return (
		<PressableText
			onPress={openAddProject}
			style={{ width: "100%", flexShrink: 0, marginTop: 1 }}
		>
			<span style={{ fg: theme.accent }}>+ </span>
			<span style={{ fg: theme.muted }}>add project</span>
		</PressableText>
	);
}
