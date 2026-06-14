import { api } from "@/api/client";
import { ConfigureDetail } from "@/components/ConfigureDetail";
import { ConfigureSidebar } from "@/components/ConfigureSidebar";
import { SidebarScrollPanel } from "@/components/SidebarScrollPanel";
import {
	buildSidebarTree,
	findSectionByNavKey,
	findSidebarAncestorKeys,
	isContainerSection,
} from "@/lib/configure-tree";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

export function ConfigureView() {
	const { navKey } = useParams();
	const navigate = useNavigate();
	const [expandedKeys, setExpandedKeys] = useState<Set<string>>(
		() => new Set(),
	);

	const { data, isLoading, error } = useQuery({
		queryKey: ["configure-tree"],
		queryFn: () => api.configureTree(),
	});

	const sidebarTree = useMemo(
		() => (data ? buildSidebarTree(data.tree) : []),
		[data],
	);

	const selectedNavKey = navKey ?? sidebarTree[0]?.navKey;

	const toggleExpanded = useCallback((key: string) => {
		setExpandedKeys((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}, []);

	const handleSelect = useCallback(
		(key: string) => {
			navigate(`/configure/${encodeURIComponent(key)}`);
		},
		[navigate],
	);

	// Expand ancestors of the current selection so it stays visible in the tree.
	useEffect(() => {
		if (!selectedNavKey || sidebarTree.length === 0) return;
		const ancestors = findSidebarAncestorKeys(sidebarTree, selectedNavKey);
		if (!ancestors?.length) return;
		setExpandedKeys((prev) => {
			const next = new Set(prev);
			for (const key of ancestors) next.add(key);
			return next;
		});
	}, [selectedNavKey, sidebarTree]);

	if (isLoading) {
		return (
			<p className="text-muted-foreground px-8 py-6">Loading configuration…</p>
		);
	}
	if (error || !data) {
		return (
			<p className="text-destructive px-8 py-6">
				{error instanceof Error
					? error.message
					: "Failed to load configuration"}
			</p>
		);
	}

	const section = selectedNavKey
		? findSectionByNavKey(data.tree, selectedNavKey)
		: null;

	return (
		<div className="flex h-full min-h-0">
			<aside className="w-72 shrink-0 border-r bg-sidebar/40 flex flex-col min-h-0 h-full">
				<SidebarScrollPanel>
					<ConfigureSidebar
						nodes={sidebarTree}
						selectedNavKey={selectedNavKey}
						expandedKeys={expandedKeys}
						onToggleExpand={toggleExpanded}
						onSelect={handleSelect}
					/>
				</SidebarScrollPanel>
			</aside>
			<div className="flex-1 overflow-y-auto min-w-0 min-h-0">
				<div className="px-8 py-8">
					{section ? (
						<ConfigureDetail
							section={section}
							values={data.values}
							isContainer={isContainerSection(section)}
							integrationLabels={data.integrationLabels ?? {}}
						/>
					) : (
						<p className="text-muted-foreground">Select a section</p>
					)}
				</div>
			</div>
		</div>
	);
}
