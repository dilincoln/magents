import { theme } from "../lib/theme";
import { useSidebarStore } from "../store/use-sidebar-store";
import { AddProjectButton } from "./add-project-button";
import { ImportSessionButton } from "./import-session-button";
import { Roster } from "./roster";
import { SearchBar } from "./search-bar";

/**
 * Search on top, the roster under it — one column, one concern.
 *
 * Its width is the one piece of layout anybody can move, by dragging the seam
 * or with `⌃⌥←` and `⌃⌥→`. See `SidebarSeam` for why that is possible without
 * drawing anything.
 */
export function Sidebar() {
	const width = useSidebarStore((state) => state.width);

	return (
		<box
			style={{
				width,
				height: "100%",
				flexShrink: 0,
				flexDirection: "column",
				paddingTop: 1,
				paddingLeft: 2,
				paddingRight: 1,
				backgroundColor: theme.panel,
			}}
		>
			<SearchBar />

			{/*
			 * The roster takes what is left and no more. Without a box that is
			 * allowed to shrink, its rows — every one of them `flexShrink: 0`, so
			 * that a selected line keeps its full height — push the two rows below
			 * off the bottom of the terminal as soon as the list is long enough.
			 * What happens inside that room is the roster's own: it scrolls, and
			 * follows the cursor. The wheel scrolls it too, which is why nothing
			 * here listens for the wheel any more.
			 */}
			<box
				style={{
					width: "100%",
					flexGrow: 1,
					flexShrink: 1,
					overflow: "hidden",
					flexDirection: "column",
					backgroundColor: theme.panel,
				}}
			>
				<Roster />
			</box>

			<AddProjectButton />

			<ImportSessionButton />

			<SidebarSeam />
		</box>
	);
}

/**
 * The last column of the sidebar, made draggable without being made visible.
 *
 * There is no border between the two panes — the seam is a change of background
 * colour and nothing more — and a resize handle that had to be drawn would be a
 * line added to the screen for the sake of a gesture that is used twice. So
 * this is a box with no colour on it: it paints nothing, and the hit test finds
 * it anyway, so the pointer has something to grab where the eye sees only an
 * edge.
 *
 * It only starts the drag. What follows the pointer is the box that holds both
 * panes, because one column is a target the pointer leaves on the first
 * movement — see `resizing` in the store.
 */
function SidebarSeam() {
	const beginResize = useSidebarStore((state) => state.beginResize);

	return (
		<box
			onMouseDown={(event) => {
				beginResize();
				// the roster is underneath and would take this as a click on
				// whichever row the seam happens to cross
				event.stopPropagation();
			}}
			style={{
				position: "absolute",
				top: 0,
				right: 0,
				width: 1,
				height: "100%",
				// above the roster, which is what it is being grabbed instead of
				zIndex: 1,
			}}
		/>
	);
}
