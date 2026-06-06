import { Version3Client } from "jira.js/version3";
import { getIntegrationCredential, readCredentials } from "../../config/index";

export interface JiraCredentials {
	readonly domain: string;
	readonly email: string;
	readonly apiToken: string;
}

export function getJiraCredentialsRaw(): JiraCredentials | undefined {
	const creds = readCredentials();
	const domain = getIntegrationCredential(creds, "jira", "domain");
	const email = getIntegrationCredential(creds, "jira", "email");
	const apiToken = getIntegrationCredential(creds, "jira", "apiToken");
	if (!domain || !email || !apiToken) return undefined;
	return { domain, email, apiToken };
}

function getJiraCredentials(): JiraCredentials {
	const creds = getJiraCredentialsRaw();
	if (!creds) {
		throw new Error(
			"Jira credentials not found. Add them to ~/.toby/credentials.json or run `toby configure`.",
		);
	}
	return creds;
}

export function buildJiraClient(creds: JiraCredentials): Version3Client {
	return new Version3Client({
		host: `https://${creds.domain}.atlassian.net`,
		authentication: {
			basic: {
				email: creds.email,
				apiToken: creds.apiToken,
			},
		},
	});
}

function getClient(): Version3Client {
	return buildJiraClient(getJiraCredentials());
}

// --- Simplified response types for tools ---

export interface JiraIssueSummary {
	readonly key: string;
	readonly id: string;
	readonly summary: string;
	readonly status: string;
	readonly assignee: string;
	readonly priority: string;
	readonly issuetype: string;
	readonly project: string;
	readonly updated: string;
}

export interface JiraIssueDetail {
	readonly key: string;
	readonly id: string;
	readonly summary: string;
	readonly status: string;
	readonly assignee: string;
	readonly priority: string;
	readonly issuetype: string;
	readonly labels: readonly string[];
	readonly project: { readonly key: string; readonly name: string } | null;
	readonly created: string;
	readonly updated: string;
	readonly description: unknown;
}

export interface JiraSearchResult {
	readonly issues: readonly JiraIssueSummary[];
	readonly issueCount: number;
	readonly nextPageToken?: string;
}

export interface JiraCommentResult {
	readonly id: string;
	readonly author: string;
	readonly created: string;
	readonly updated: string;
	readonly body: unknown;
}

export interface JiraCommentsResult {
	readonly comments: readonly JiraCommentResult[];
	readonly total: number;
	readonly startAt: number;
}

export interface JiraProjectResult {
	readonly key: string;
	readonly name: string;
	readonly id: string;
	readonly type: string;
}

export interface JiraProjectsResult {
	readonly projects: readonly JiraProjectResult[];
	readonly total: number;
}

// --- Field extraction helpers ---

function extractIssueSummary(
	fields: Record<string, unknown>,
): JiraIssueSummary {
	const project = fields.project as { key?: string; name?: string } | undefined;
	const projectStr = project
		? `${project.key ?? ""} - ${project.name ?? ""}`
		: "";
	const status = fields.status as { name?: string } | undefined;
	const assignee = fields.assignee as
		| { displayName?: string }
		| undefined
		| null;
	const priority = fields.priority as { name?: string } | undefined | null;
	const issuetype = fields.issuetype as { name?: string } | undefined;
	return {
		key: "",
		id: "",
		summary: (fields.summary as string) ?? "",
		status: status?.name ?? "",
		assignee: assignee?.displayName ?? "Unassigned",
		priority: priority?.name ?? "",
		issuetype: issuetype?.name ?? "",
		project: projectStr,
		updated: (fields.updated as string) ?? "",
	};
}

function extractIssueDetail(
	fields: Record<string, unknown>,
): Omit<JiraIssueDetail, "key" | "id"> {
	const project = fields.project as { key?: string; name?: string } | undefined;
	const status = fields.status as { name?: string } | undefined;
	const assignee = fields.assignee as
		| { displayName?: string }
		| undefined
		| null;
	const priority = fields.priority as { name?: string } | undefined | null;
	const issuetype = fields.issuetype as { name?: string } | undefined;
	return {
		summary: (fields.summary as string) ?? "",
		status: status?.name ?? "",
		assignee: assignee?.displayName ?? "Unassigned",
		priority: priority?.name ?? "None",
		issuetype: issuetype?.name ?? "",
		labels: (fields.labels as string[]) ?? [],
		project: project
			? { key: project.key ?? "", name: project.name ?? "" }
			: null,
		created: (fields.created as string) ?? "",
		updated: (fields.updated as string) ?? "",
		description: fields.description ?? null,
	};
}

/** Fields to request from the enhanced search /search/jql endpoint (it only returns issue IDs by default). */
const SEARCH_FIELDS = [
	"summary",
	"status",
	"assignee",
	"priority",
	"issuetype",
	"project",
	"updated",
	"created",
	"labels",
	"description",
];

// --- API functions ---

export async function testJiraConnection(): Promise<void> {
	const client = getClient();
	await client.myself.getCurrentUser();
}

export async function searchIssues(
	jql: string,
	options?: {
		readonly maxResults?: number;
		readonly nextPageToken?: string;
	},
): Promise<JiraSearchResult> {
	const client = getClient();
	const response =
		await client.issueSearch.searchForIssuesUsingJqlEnhancedSearch({
			jql,
			maxResults: options?.maxResults ?? 50,
			nextPageToken: options?.nextPageToken,
			fields: SEARCH_FIELDS,
			fieldsByKeys: true,
		});

	const issues = (response.issues ?? []).map((issue) => ({
		...extractIssueSummary(issue.fields),
		key: issue.key ?? "",
		id: String(issue.id ?? ""),
	}));

	return {
		issueCount: issues.length,
		nextPageToken: response.nextPageToken ?? undefined,
		issues,
	};
}

export async function getIssue(issueIdOrKey: string): Promise<JiraIssueDetail> {
	const client = getClient();
	const issue = await client.issues.getIssue({ issueIdOrKey });

	return {
		key: issue.key ?? "",
		id: String(issue.id ?? ""),
		...extractIssueDetail(issue.fields),
	};
}

export async function getIssueComments(
	issueIdOrKey: string,
	options?: { readonly startAt?: number; readonly maxResults?: number },
): Promise<JiraCommentsResult> {
	const client = getClient();
	const response = await client.issueComments.getComments({
		issueIdOrKey,
		startAt: options?.startAt ?? 0,
		maxResults: options?.maxResults ?? 50,
	});

	return {
		total: response.total ?? 0,
		startAt: response.startAt ?? 0,
		comments: (response.comments ?? []).map((c) => ({
			id: String(c.id ?? ""),
			author: c.author?.displayName ?? "Unknown",
			created: c.created ?? "",
			updated: c.updated ?? "",
			body: c.body,
		})),
	};
}

export async function listProjects(options?: {
	readonly startAt?: number;
	readonly maxResults?: number;
}): Promise<JiraProjectsResult> {
	const client = getClient();
	const response = await client.projects.searchProjects({
		startAt: options?.startAt ?? 0,
		maxResults: options?.maxResults ?? 50,
	});

	return {
		total: response.total ?? 0,
		projects: (response.values ?? []).map((p) => ({
			key: p.key ?? "",
			name: p.name ?? "",
			id: String(p.id ?? ""),
			type: p.projectTypeKey ?? "",
		})),
	};
}
