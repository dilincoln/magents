import { useAppStore } from "../store/use-app-store";
import { useSidebarStore } from "../store/use-sidebar-store";

/**
 * What `⌃e` does: the sidebar goes, or comes back.
 *
 * The search lives in the sidebar, so hiding it while the search holds the
 * keyboard would leave the letters going into a field nobody can see. The
 * keyboard goes back to the roster first — the query itself stays, the same
 * as it does when `esc` leaves the field.
 */
export function toggleSidebar(): void {
	const sidebar = useSidebarStore.getState();
	const app = useAppStore.getState();

	if (sidebar.visible && app.focus === "search") app.focusRoster();
	sidebar.toggle();
}
