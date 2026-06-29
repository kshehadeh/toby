import {
	type JsonRecord,
	getIssue,
	getIssueComments,
	intValue,
	listProjects,
	searchIssues,
	stringValue,
} from "./client";

type ToolDefinition = {
	name: string;
	displayName: string;
	description: string;
	readOnly?: boolean;
	inputSchema: JsonRecord;
};

const TOOL_DEFINITIONS: ToolDefinition[] = [
	{
		name: "searchJiraIssues",
		displayName: "Search Jira issues",
		description:
			"Search Jira issues using JQL (Jira Query Language). Returns matching issues with key, summary, status, assignee, and priority. Use JQL syntax like: assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				jql: {
					type: "string",
					description:
						"JQL query string. Examples: 'project = PROJ', 'assignee = currentUser() AND status != Done', 'key = PROJ-123'",
				},
				maxResults: {
					type: "number",
					description: "Maximum issues to return (1-100, default 50)",
				},
				nextPageToken: {
					type: "string",
					description:
						"Token for fetching the next page of results (from previous search response)",
				},
			},
			required: ["jql"],
		},
	},
	{
		name: "getJiraIssue",
		displayName: "Get Jira issue",
		description:
			"Get full details of a Jira issue by its key (e.g. PROJ-123). Returns summary, description, status, assignee, priority, labels, and more.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				issueKey: {
					type: "string",
					description: "Jira issue key, e.g. PROJ-123",
				},
			},
			required: ["issueKey"],
		},
	},
	{
		name: "getJiraIssueComments",
		displayName: "Get Jira issue comments",
		description:
			"Get comments for a Jira issue by its key. Returns paginated comments with author, body, and timestamps.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				issueKey: {
					type: "string",
					description: "Jira issue key, e.g. PROJ-123",
				},
				maxResults: {
					type: "number",
					description: "Maximum comments to return (1-100, default 50)",
				},
				startAt: {
					type: "number",
					description: "Offset for pagination (default 0)",
				},
			},
			required: ["issueKey"],
		},
	},
	{
		name: "listJiraProjects",
		displayName: "List Jira projects",
		description:
			"List Jira projects accessible to the authenticated user. Returns project key, name, and type.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				maxResults: {
					type: "number",
					description: "Maximum projects to return (1-100, default 50)",
				},
				startAt: {
					type: "number",
					description: "Offset for pagination (default 0)",
				},
			},
		},
	},
];

export type ExecuteResult = {
	result: JsonRecord;
	appliedActions: string[];
};

export async function executeTool(
	tool: string,
	input: JsonRecord,
	config: JsonRecord,
	dryRun: boolean,
): Promise<ExecuteResult> {
	switch (tool) {
		case "searchJiraIssues": {
			const jql = stringValue(input.jql)?.trim();
			if (!jql) {
				throw new Error("jql is required.");
			}
			if (dryRun) {
				const msg = `[DRY RUN] Would search Jira with JQL: "${jql}"`;
				return {
					result: { dryRun: true, message: msg, jql },
					appliedActions: [msg],
				};
			}
			const response = await searchIssues(
				config,
				jql,
				intValue(input.maxResults) ?? 50,
				stringValue(input.nextPageToken),
			);
			const count = intValue(response.issueCount) ?? 0;
			const msg = `Jira search: "${jql}" — ${count} result(s)`;
			return { result: response, appliedActions: [msg] };
		}

		case "getJiraIssue": {
			const issueKey = stringValue(input.issueKey)?.trim();
			if (!issueKey) {
				throw new Error("issueKey is required.");
			}
			if (dryRun) {
				const msg = `[DRY RUN] Would fetch Jira issue "${issueKey}"`;
				return {
					result: { dryRun: true, message: msg, issueKey },
					appliedActions: [msg],
				};
			}
			const issue = await getIssue(config, issueKey);
			const msg = `Fetched Jira issue "${issueKey}"`;
			return { result: issue, appliedActions: [msg] };
		}

		case "getJiraIssueComments": {
			const issueKey = stringValue(input.issueKey)?.trim();
			if (!issueKey) {
				throw new Error("issueKey is required.");
			}
			if (dryRun) {
				const msg = `[DRY RUN] Would fetch comments for Jira issue "${issueKey}"`;
				return {
					result: { dryRun: true, message: msg, issueKey },
					appliedActions: [msg],
				};
			}
			const response = await getIssueComments(
				config,
				issueKey,
				intValue(input.startAt) ?? 0,
				intValue(input.maxResults) ?? 50,
			);
			const comments = (response.comments ?? []) as JsonRecord[];
			const total = intValue(response.total) ?? comments.length;
			const msg = `Fetched ${comments.length}/${total} comment(s) for Jira issue "${issueKey}"`;
			return { result: response, appliedActions: [msg] };
		}

		case "listJiraProjects": {
			if (dryRun) {
				const msg = "[DRY RUN] Would list Jira projects";
				return {
					result: { dryRun: true, message: msg },
					appliedActions: [msg],
				};
			}
			const response = await listProjects(
				config,
				intValue(input.startAt) ?? 0,
				intValue(input.maxResults) ?? 50,
			);
			const projects = (response.projects ?? []) as JsonRecord[];
			const total = intValue(response.total) ?? projects.length;
			const msg = `Fetched ${projects.length}/${total} Jira project(s)`;
			return { result: response, appliedActions: [msg] };
		}

		default:
			throw new Error(`Unknown tool: ${tool}`);
	}
}

export { TOOL_DEFINITIONS };
