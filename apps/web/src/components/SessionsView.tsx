import { api } from "@/api/client";
import { SessionTranscript } from "@/components/SessionTranscript";
import { SidebarScrollPanel } from "@/components/SidebarScrollPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";

export function SessionsView() {
	const { sessionId } = useParams();
	const navigate = useNavigate();

	const sessionsQuery = useQuery({
		queryKey: ["sessions"],
		queryFn: () => api.sessions(),
	});

	const detailQuery = useQuery({
		queryKey: ["session", sessionId],
		queryFn: () => {
			if (!sessionId) {
				throw new Error("Session id is required");
			}
			return api.session(sessionId);
		},
		enabled: Boolean(sessionId),
	});

	if (sessionsQuery.isLoading) {
		return <p className="text-muted-foreground px-8 py-6">Loading sessions…</p>;
	}

	const sessions = sessionsQuery.data?.sessions ?? [];

	return (
		<div className="flex h-full min-h-0">
			<aside className="w-72 shrink-0 border-r bg-sidebar/40 flex flex-col min-h-0 h-full">
				<SidebarScrollPanel>
					<nav className="px-3 py-4 space-y-1">
						{sessions.map((s) => (
							<button
								key={s.id}
								type="button"
								onClick={() =>
									navigate(`/sessions/${encodeURIComponent(s.id)}`)
								}
								className={cn(
									"w-full text-left text-sm px-3 py-2.5 rounded-md hover:bg-accent/80 transition-colors",
									sessionId === s.id && "bg-accent font-medium",
								)}
							>
								<div className="truncate font-medium">{s.name}</div>
								<div className="text-xs text-muted-foreground truncate mt-0.5">
									{new Date(s.updatedAt).toLocaleString()}
								</div>
							</button>
						))}
						{sessions.length === 0 && (
							<p className="text-sm text-muted-foreground px-3">
								No sessions yet
							</p>
						)}
					</nav>
				</SidebarScrollPanel>
			</aside>
			<div className="flex-1 overflow-y-auto min-w-0 min-h-0">
				<div className="mx-auto max-w-4xl px-8 py-8">
					{sessionId && detailQuery.isLoading && (
						<p className="text-muted-foreground">Loading session…</p>
					)}
					{sessionId && detailQuery.data && (
						<Card className="ring-0 shadow-none">
							<CardHeader className="pb-4">
								<CardTitle className="text-xl">
									{detailQuery.data.name}
								</CardTitle>
								<p className="text-sm text-muted-foreground">
									{detailQuery.data.messageCount} model messages
								</p>
							</CardHeader>
							<CardContent>
								<div className="h-[calc(100vh-14rem)] overflow-y-auto overscroll-contain rounded-md bg-muted/30 p-4">
									<SessionTranscript entries={detailQuery.data.transcript} />
								</div>
							</CardContent>
						</Card>
					)}
					{!sessionId && (
						<p className="text-muted-foreground">Select a session to view</p>
					)}
				</div>
			</div>
		</div>
	);
}
