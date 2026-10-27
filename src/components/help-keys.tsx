import { bindings } from "../constants/bindings";
import { theme } from "../lib/theme";

/** What the keyboard does, straight off the table that does it. */
export function HelpKeys() {
	return (
		<>
			{bindings.map((binding) => (
				<text
					key={binding.label}
					selectable={false}
					style={{ width: "100%", flexShrink: 0 }}
				>
					<span style={{ fg: theme.accent }}>
						{binding.label.padStart(3).padEnd(7)}
					</span>
					<span style={{ fg: theme.muted }}>{binding.description}</span>
				</text>
			))}

			{/*
			 * A sentence, not a row in the table. The mouse is not a binding — it
			 * works on whatever it lands on, and listing "click" beside the keys
			 * made it look like one more shortcut to remember.
			 */}
			<text
				selectable={false}
				style={{ width: "100%", flexShrink: 0, marginTop: 1, fg: theme.faint }}
			>
				all of this works with the mouse too
			</text>
		</>
	);
}
