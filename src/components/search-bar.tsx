import { barCursor } from "../constants/bar-cursor";
import { theme } from "../lib/theme";
import { useKeyboardOwner } from "../store/keyboard-owner";
import { useAppStore } from "../store/use-app-store";

/**
 * One search across everything: name, description, provider, model, tools and
 * project. `/` focuses it, escape gives the keyboard back to the shortcuts.
 * How many agents it left standing is reported in the header.
 *
 * The input is controlled from the store. That is safe here because the
 * reconciler only assigns `value` when the string actually differs, so echoing
 * the store value back never moves the caret.
 */
export function SearchBar() {
	const query = useAppStore((state) => state.query);
	const focused = useKeyboardOwner() === "search";

	return (
		<box
			onMouseDown={() => useAppStore.getState().focusSearch()}
			style={{
				width: "100%",
				flexShrink: 0,
				flexDirection: "row",
				marginBottom: 1,
				backgroundColor: theme.panel,
			}}
		>
			<text
				selectable={false}
				style={{
					flexShrink: 0,
					fg: focused ? theme.accent : theme.muted,
					bg: theme.panel,
				}}
			>
				⌕{" "}
			</text>

			<input
				focused={focused}
				value={query}
				placeholder="search sessions…"
				onInput={(value: string) => useAppStore.getState().setQuery(value)}
				onSubmit={() => useAppStore.getState().focusRoster()}
				style={{
					flexGrow: 1,
					flexShrink: 1,
					backgroundColor: theme.panel,
					focusedBackgroundColor: theme.panel,
					textColor: theme.text,
					focusedTextColor: theme.text,
					placeholderColor: theme.faint,
					cursorColor: theme.accent,
					cursorStyle: barCursor,
				}}
			/>
		</box>
	);
}
