import type { SettingsItem } from "@/types";

/** Keys that should never appear in the web configure sidebar. */
const SIDEBAR_EXCLUDED_KEYS = new Set([
	"listen._start",
	"personas._new",
	"schedules._new",
]);

function isSidebarSection(item: SettingsItem): boolean {
	if (item.kind !== "section") return false;
	if (SIDEBAR_EXCLUDED_KEYS.has(item.key)) return false;
	if (item.key.endsWith("._hint") || item.key.endsWith("._empty")) return false;
	return true;
}

export interface SidebarTreeNode {
	readonly item: SettingsItem;
	readonly navKey: string;
	readonly depth: number;
	readonly children: SidebarTreeNode[];
}

function buildSidebarNode(
	node: SettingsItem,
	depth: number,
): SidebarTreeNode | null {
	if (!isSidebarSection(node)) return null;

	const navKey = node.navKey ?? node.key;
	const children: SidebarTreeNode[] = [];
	for (const child of node.children ?? []) {
		if (child.kind === "section") {
			const built = buildSidebarNode(child, depth + 1);
			if (built) children.push(built);
		}
	}

	return { item: node, navKey, depth, children };
}

export function buildSidebarTree(root: SettingsItem): SidebarTreeNode[] {
	const nodes: SidebarTreeNode[] = [];
	for (const child of root.children ?? []) {
		const built = buildSidebarNode(child, 0);
		if (built) nodes.push(built);
	}
	return nodes;
}

/** Nav keys of ancestors that must be expanded to reveal `targetKey`. */
export function findSidebarAncestorKeys(
	nodes: readonly SidebarTreeNode[],
	targetKey: string,
	ancestors: string[] = [],
): string[] | null {
	for (const node of nodes) {
		if (node.navKey === targetKey) return ancestors;
		if (node.children.length > 0) {
			const found = findSidebarAncestorKeys(node.children, targetKey, [
				...ancestors,
				node.navKey,
			]);
			if (found) return found;
		}
	}
	return null;
}

export function flattenSidebarSections(
	root: SettingsItem,
): Array<{ item: SettingsItem; depth: number; navKey: string }> {
	const rows: Array<{ item: SettingsItem; depth: number; navKey: string }> =
		[];

	function walk(node: SettingsItem, depth: number) {
		if (node.key === "root") {
			for (const child of node.children ?? []) {
				walk(child, 0);
			}
			return;
		}

		if (!isSidebarSection(node)) return;

		const navKey = node.navKey ?? node.key;
		rows.push({ item: node, depth, navKey });

		for (const child of node.children ?? []) {
			if (child.kind === "section") {
				walk(child, depth + 1);
			}
		}
	}

	walk(root, 0);
	return rows;
}

/** @deprecated Use flattenSidebarSections for web UI navigation. */
export function flattenTreeSections(
	root: SettingsItem,
): Array<{ item: SettingsItem; depth: number; navKey: string }> {
	return flattenSidebarSections(root);
}

export function findSectionByNavKey(
	root: SettingsItem,
	navKey: string,
): SettingsItem | null {
	function walk(node: SettingsItem): SettingsItem | null {
		if (node.key === "root") {
			for (const child of node.children ?? []) {
				const found = walk(child);
				if (found) return found;
			}
			return null;
		}
		const key = node.navKey ?? node.key;
		if (key === navKey) return node;
		for (const child of node.children ?? []) {
			if (child.kind === "section") {
				const found = walk(child);
				if (found) return found;
			}
		}
		return null;
	}
	return walk(root);
}

export function sectionHasEditableFields(section: SettingsItem): boolean {
	return (section.children ?? []).some(
		(c) => c.kind !== "section" || !(c.children?.length ?? 0),
	);
}

export function isContainerSection(section: SettingsItem): boolean {
	const children = section.children ?? [];
	const substantive = children.filter(
		(c) => c.kind !== "hint" && c.kind !== "action",
	);
	if (substantive.length === 0) return false;
	return substantive.every(
		(c) => c.kind === "section" && (c.children?.length ?? 0) > 0,
	);
}
