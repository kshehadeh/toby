const TOOL_LABEL_OVERRIDES: Record<string, string> = {
	askUser: "Ask you to choose",
	getInboxUnreadOverview: "Fetch inbox overview",
	getUnreadEmailMetadataBatch: "Fetch email metadata",
	archiveEmailById: "Archive email by ID",
	markAsReadById: "Mark email as read",
	applyMultipleLabelsByMessageId: "Apply labels to email by ID",
	listLabels: "List Gmail labels",
	createAndApplyLabel: "Create and apply label",
	applyMultipleLabels: "Apply multiple labels",
	markAsRead: "Mark current email as read",
	archiveEmail: "Archive current email",
	getRecentEmails: "Fetch recent unread emails",
	fetchOpenTasks: "Fetch open Todoist tasks",
	fetchCompletedTasks: "Fetch completed Todoist tasks",
	completeTask: "Complete Todoist task",
	createTask: "Create Todoist task",
	updateTask: "Update Todoist task",
	listUsers: "List Azure AD users",
	searchUsers: "Search Azure AD users",
	getUser: "Get Azure AD user",
	getUserManager: "Get user manager",
	getUserDirectReports: "Get direct reports",
};

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
	return TOOL_LABEL_OVERRIDES[toolName] ?? humanizeToolName(toolName);
}

export function getToolStatusLabel(toolName: string): string {
	const label = getToolDisplayLabel(toolName);
	return label.charAt(0).toLowerCase() + label.slice(1);
}
