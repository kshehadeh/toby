import { getToolStatusLabel } from "./tool-labels";

export function formatToolStatusLine(toolName: string): string {
	if (toolName === "askUser") {
		return "Waiting for your choice…";
	}
	return `Calling ${getToolStatusLabel(toolName)}…`;
}
