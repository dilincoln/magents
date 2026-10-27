import { QueryClient } from "@tanstack/react-query";

/**
 * One client for the process.
 *
 * A module singleton rather than a `useState` in the root, because the cache is
 * read from outside React too: `moveCursor` counts the rows the roster paints,
 * and it runs in a key handler, not in a render.
 *
 * Two defaults are deliberate:
 *
 * - **No retries.** The backend is a socket on this machine. It answers or it
 *   is not running, and three retries with backoff would only delay the amber
 *   dot that says so.
 * - **Never stale on its own.** Nothing here is a feed. The data changes when
 *   this process changes it, so refetching is something a mutation asks for by
 *   name, and clicking the status dot is a `refetch` that says so out loud.
 *
 * Neither of those covers the daemon coming up after the screen, or going away
 * while it is open. That is `useDaemonHeartbeat`, and it is a
 * timer of its own rather than `refetchInterval` for a plain reason: the
 * interval never fires here. Measured, not assumed — with an observer
 * subscribed and a 500ms interval, a query that succeeds fetches exactly once
 * in two seconds, and so does one that fails.
 */
export const queryClient = new QueryClient({
	defaultOptions: {
		queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
	},
});
