import { AppShell } from "@/components/AppShell";
import { ConfigureView } from "@/components/ConfigureView";
import { MemoriesView } from "@/components/MemoriesView";
import { SessionsView } from "@/components/SessionsView";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: { staleTime: 5_000, retry: 1 },
	},
});

export default function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<BrowserRouter>
					<Routes>
						<Route path="/" element={<AppShell />}>
							<Route index element={<Navigate to="/configure" replace />} />
							<Route path="configure">
								<Route index element={<ConfigureView />} />
								<Route path=":navKey" element={<ConfigureView />} />
							</Route>
							<Route path="sessions">
								<Route index element={<SessionsView />} />
								<Route path=":sessionId" element={<SessionsView />} />
							</Route>
							<Route path="memories">
								<Route index element={<MemoriesView />} />
								<Route path=":memoryId" element={<MemoriesView />} />
							</Route>
						</Route>
					</Routes>
				</BrowserRouter>
			</TooltipProvider>
		</QueryClientProvider>
	);
}
