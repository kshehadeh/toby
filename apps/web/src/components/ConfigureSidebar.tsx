import { getSidebarSectionIcon } from "@/lib/configure-sidebar-icons";
import type { SidebarTreeNode } from "@/lib/configure-tree";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

interface ConfigureSidebarProps {
	readonly nodes: SidebarTreeNode[];
	readonly selectedNavKey?: string;
	readonly expandedKeys: ReadonlySet<string>;
	readonly onToggleExpand: (navKey: string) => void;
	readonly onSelect: (navKey: string) => void;
}

export function ConfigureSidebar({
	nodes,
	selectedNavKey,
	expandedKeys,
	onToggleExpand,
	onSelect,
}: ConfigureSidebarProps) {
	return (
		<nav className="px-2 py-4 space-y-0.5">
			{nodes.map((node) => (
				<ConfigureSidebarNode
					key={node.navKey}
					node={node}
					selectedNavKey={selectedNavKey}
					expandedKeys={expandedKeys}
					onToggleExpand={onToggleExpand}
					onSelect={onSelect}
				/>
			))}
		</nav>
	);
}

function ConfigureSidebarNode({
	node,
	selectedNavKey,
	expandedKeys,
	onToggleExpand,
	onSelect,
}: {
	node: SidebarTreeNode;
	selectedNavKey?: string;
	expandedKeys: ReadonlySet<string>;
	onToggleExpand: (navKey: string) => void;
	onSelect: (navKey: string) => void;
}) {
	const hasChildren = node.children.length > 0;
	const isExpanded = expandedKeys.has(node.navKey);
	const isSelected = selectedNavKey === node.navKey;
	const SectionIcon = getSidebarSectionIcon(node.item.key, node.depth);

	return (
		<div>
			<div
				className={cn(
					"flex items-stretch rounded-md min-w-0",
					isSelected && "bg-accent",
				)}
			>
				{hasChildren ? (
					<button
						type="button"
						aria-expanded={isExpanded}
						aria-label={isExpanded ? "Collapse section" : "Expand section"}
						onClick={() => onToggleExpand(node.navKey)}
						className="shrink-0 flex items-center justify-center w-7 text-muted-foreground hover:text-foreground"
					>
						<ChevronRight
							className={cn(
								"size-4 transition-transform duration-150",
								isExpanded && "rotate-90",
							)}
						/>
					</button>
				) : (
					<span className="w-7 shrink-0" aria-hidden />
				)}
				<button
					type="button"
					onClick={() => onSelect(node.navKey)}
					className={cn(
						"flex flex-1 min-w-0 items-center gap-2 text-left text-sm py-2 pr-3 hover:text-foreground transition-colors",
						isSelected ? "font-medium" : "text-foreground/90",
						!isSelected && "hover:bg-accent/50 rounded-r-md",
					)}
				>
					{SectionIcon ? (
						<SectionIcon
							className={cn(
								"size-4 shrink-0",
								isSelected ? "text-foreground" : "text-muted-foreground",
							)}
							aria-hidden
						/>
					) : null}
					<span className="truncate">{node.item.label}</span>
				</button>
			</div>
			{hasChildren && isExpanded && (
				<div className="ml-3 border-l border-border/60 pl-1 mt-0.5 space-y-0.5">
					{node.children.map((child) => (
						<ConfigureSidebarNode
							key={child.navKey}
							node={child}
							selectedNavKey={selectedNavKey}
							expandedKeys={expandedKeys}
							onToggleExpand={onToggleExpand}
							onSelect={onSelect}
						/>
					))}
				</div>
			)}
		</div>
	);
}
