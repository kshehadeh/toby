/**
 * Core/global tool display labels. Plugin-specific tool labels are provided
 * by plugins themselves via the `displayName` field on tool definitions
 * (see {@link registerPluginToolLabels}) and looked up at runtime.
 */
const CORE_TOOL_LABELS: Record<string, string> = {
	askUser: "Ask you to choose",
	createLocalSkill: "Create local Toby skill",
	getWeather: "Get weather",
	getMyLocation: "Get my location",
	readPdf: "Read PDF",
	listProjectFiles: "List project files",
	searchProjectFiles: "Search project files",
	readProjectFile: "Read project file",
	createProjectFolder: "Create project folder",
	renameProjectFile: "Move project file",
	deleteProjectFile: "Delete project file",
	saveProjectAttachment: "Save project attachment",
	memorySearch: "Search memory",
	memoryPropose: "Propose memory",
	memorySave: "Save memory",
	memoryForget: "Forget memory",
	memoryExplain: "Explain memory",
	memoryRetrieveForTask: "Retrieve memories for task",
	listListenRecordings: "List listen recordings",
	readTranscript: "Read listen transcript",
};

/**
 * Registry of plugin-provided tool labels, populated when plugin tool
 * definitions are loaded. Maps tool name → human-readable display label.
 */
const pluginToolLabels = new Map<string, string>();

/**
 * Register tool display labels from a plugin's `tools list` response.
 * Called by the plugin adapter when tool definitions are loaded.
 */
export function registerPluginToolLabels(
	tools: ReadonlyArray<{
		readonly name: string;
		readonly displayName?: string;
	}>,
): void {
	for (const t of tools) {
		if (t.displayName) {
			pluginToolLabels.set(t.name, t.displayName);
		}
	}
}

/** Clear all registered plugin tool labels (used in tests). */
export function clearPluginToolLabels(): void {
	pluginToolLabels.clear();
}

function humanizeToolName(toolName: string): string {
	const tokenized = toolName
		.replace(/_/g, " ")
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.trim()
		.split(/\s+/)
		.filter(Boolean);

	if (tokenized.length === 0) {
		return toolName;
	}

	return tokenized
		.map((part, index) => {
			const lower = part.toLowerCase();
			if (lower === "id") {
				return "ID";
			}
			if (index === 0) {
				return lower.charAt(0).toUpperCase() + lower.slice(1);
			}
			return lower;
		})
		.join(" ");
}

export function getToolDisplayLabel(toolName: string): string {
	return (
		pluginToolLabels.get(toolName) ??
		CORE_TOOL_LABELS[toolName] ??
		humanizeToolName(toolName)
	);
}

export function getToolStatusLabel(toolName: string): string {
	const label = getToolDisplayLabel(toolName);
	return label.charAt(0).toLowerCase() + label.slice(1);
}
