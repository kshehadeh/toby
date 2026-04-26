export function formatToolStatusLine(toolName: string): string {
	if (toolName === "askUser") {
		return "Waiting for your choice…";
	}
	const spaced = toolName.replace(/_/g, " ");
	return `Calling ${spaced}…`;
}
