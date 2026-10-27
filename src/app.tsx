import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./queries/query-client";
import { AgentsScreen } from "./screens/agents-screen";

/** One screen today; this is where screen routing will live. */
export function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<AgentsScreen />
		</QueryClientProvider>
	);
}
