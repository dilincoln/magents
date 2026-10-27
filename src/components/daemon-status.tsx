import { useQuery } from "@tanstack/react-query";
import { theme } from "../lib/theme";
import { healthQuery } from "../queries/health-query";
import { PressableText } from "./ui/pressable";

/**
 * Whether the backend answered, as one character next to the tagline.
 *
 * No label. Where projects come from is not something the screen needs to
 * teach: it matters exactly when it stops working, and then the colour is the
 * whole message. Clicking it refetches, which is what you want the moment the
 * backend is up again.
 *
 * Three states, and they are the query's own — asking, answered, refused. This
 * used to be a field in a store that every call site had to remember to set,
 * which is a status that can be wrong; here there is nothing to keep in sync,
 * because the thing being described is the thing being read.
 *
 * It reads `health` and not `projects`, which is the difference between a
 * status and a memory. Projects are fetched once and never again, so a dot
 * following them stayed green over a daemon that had died hours ago — it was
 * not reporting the backend, it was reporting the last time anyone asked.
 */
export function DaemonStatus() {
	const { isPending, isError, refetch } = useQuery(healthQuery);

	const { glyph, color } = isPending
		? { glyph: "◌", color: theme.faint }
		: isError
			? { glyph: "○", color: theme.warn }
			: { glyph: "●", color: theme.ok };

	return (
		<PressableText
			onPress={() => refetch()}
			style={{ flexShrink: 0, fg: color }}
		>
			{`${glyph} `}
		</PressableText>
	);
}
