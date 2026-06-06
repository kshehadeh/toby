import { api } from "@/api/client";
import type { MemoryExplanation } from "@/types";
import { SidebarScrollPanel } from "@/components/SidebarScrollPanel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

export function MemoriesView() {
	const { memoryId } = useParams();
	const navigate = useNavigate();
	const [search, setSearch] = useState("");

	const memoriesQuery = useQuery({
		queryKey: ["memories", search],
		queryFn: () => api.memories(search || undefined),
	});

	const explainQuery = useQuery({
		queryKey: ["memory-explain", memoryId],
		queryFn: () => api.memoryExplain(memoryId!),
		enabled: Boolean(memoryId),
	});

	const memories = memoriesQuery.data?.memories ?? [];

	return (
		<div className="flex h-full min-h-0">
			<aside className="w-72 shrink-0 border-r bg-sidebar/40 flex flex-col min-h-0 h-full">
				<div className="shrink-0 px-3 py-4 border-b">
					<Input
						placeholder="Search memories…"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
				</div>
				<SidebarScrollPanel>
					<nav className="px-3 py-4 space-y-1">
						{memories.map((m) => (
							<button
								key={m.id}
								type="button"
								onClick={() =>
									navigate(`/memories/${encodeURIComponent(m.id)}`)
								}
								className={cn(
									"w-full text-left text-sm px-3 py-2.5 rounded-md hover:bg-accent/80 transition-colors",
									memoryId === m.id && "bg-accent font-medium",
								)}
							>
								<div className="truncate">
									{m.subject ?? m.value.slice(0, 40)}
								</div>
								<div className="text-xs text-muted-foreground mt-0.5">
									{m.type}
								</div>
							</button>
						))}
						{memories.length === 0 && !memoriesQuery.isLoading && (
							<p className="text-sm text-muted-foreground px-3">
								No memories found
							</p>
						)}
					</nav>
				</SidebarScrollPanel>
			</aside>
			<div className="flex-1 overflow-y-auto min-w-0 min-h-0">
				<div className="mx-auto max-w-3xl px-8 py-8">
					{memoryId && explainQuery.data && (
						<Card className="ring-0 shadow-none">
							<CardHeader className="pb-4">
								<div className="flex gap-2 flex-wrap items-center">
									<CardTitle className="text-xl">
										{explainQuery.data.explanation.item.subject ?? "Memory"}
									</CardTitle>
									<Badge>{explainQuery.data.explanation.item.type}</Badge>
									<Badge variant="outline">
										{explainQuery.data.explanation.item.sensitivity}
									</Badge>
								</div>
							</CardHeader>
							<CardContent className="space-y-6">
								<p className="whitespace-pre-wrap leading-relaxed">
									{explainQuery.data.explanation.item.value}
								</p>
								{explainQuery.data.explanation.sources.length > 0 && (
									<div>
										<h3 className="text-sm font-medium mb-3">Sources</h3>
										<ul className="text-sm text-muted-foreground space-y-2">
											{explainQuery.data.explanation.sources.map(
												(s: MemoryExplanation["sources"][number]) => (
													<li key={s.id}>
														{s.label ?? s.system} ({s.system})
													</li>
												),
											)}
										</ul>
									</div>
								)}
							</CardContent>
						</Card>
					)}
					{!memoryId && (
						<p className="text-muted-foreground">Select a memory to view</p>
					)}
				</div>
			</div>
		</div>
	);
}
