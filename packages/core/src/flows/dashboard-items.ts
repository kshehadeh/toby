import type { DashboardItem } from "../dashboard/types";

export function isDashboardItem(value: unknown): value is DashboardItem {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as DashboardItem).id === "string" &&
		typeof (value as DashboardItem).title === "string"
	);
}

/** Extract `items[]` from a standard dashboard tool result. */
export function itemsFromDashboardToolResult(result: unknown): DashboardItem[] {
	if (!result || typeof result !== "object") return [];
	const items = (result as { items?: unknown }).items;
	if (!Array.isArray(items)) return [];
	return items.filter(isDashboardItem);
}
