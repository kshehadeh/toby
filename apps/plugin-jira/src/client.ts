import { fetchAccessibleResources } from "./auth";
import {
	getConfigField,
	getJiraAuthMethod,
	hasCredentials,
	hasJiraApiTokenCredentials,
	hasJiraOAuthToken,
	jiraApiTokenCredentials,
} from "./config";
import { isJiraAccessTokenFresh, refreshJiraOAuthAccessToken } from "./tokens";

type JsonRecord = Record<string, unknown>;

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

// Module-level caches
const cloudIdCache = new Map<string, string>();
const apiBaseCache = new Map<string, string>();

export class JiraFailure extends Error {
	constructor(message: string) {
		super(message);
		this.name = "JiraFailure";
	}
}

export function stringValue(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	if (typeof value === "boolean") return String(value);
	return undefined;
}

export function intValue(value: unknown): number | undefined {
	if (typeof value === "number") return Math.trunc(value);
	return undefined;
}

export { hasCredentials, hasJiraApiTokenCredentials, hasJiraOAuthToken };

export function buildHost(domain: string): string {
	let normalized = domain.trim().replace(/^https?:\/\//, "");
	while (normalized.endsWith("/")) {
		normalized = normalized.slice(0, -1);
	}
	if (normalized.endsWith(".atlassian.net")) {
		return `https://${normalized}`;
	}
	return `https://${normalized}.atlassian.net`;
}

export function buildGatewayHost(cloudId: string): string {
	return `https://api.atlassian.com/ex/jira/${cloudId.trim()}`;
}

async function performApiTokenHTTP(
	base: string,
	path: string,
	method: string,
	body: JsonRecord | null,
	creds: { domain: string; email: string; apiToken: string },
): Promise<{ data: unknown; statusCode: number }> {
	const url = `${base}${path}`;
	const headers: Record<string, string> = {
		Accept: "application/json",
	};
	if (body) {
		headers["Content-Type"] = "application/json";
	}
	const authString = `${creds.email}:${creds.apiToken}`;
	headers.Authorization = `Basic ${Buffer.from(authString).toString("base64")}`;

	const response = await fetch(url, {
		method,
		headers,
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = await response.text();
	let parsed: unknown = data;
	try {
		parsed = JSON.parse(data);
	} catch {
		// keep raw text
	}
	return { data: parsed, statusCode: response.status };
}

async function performOAuthHTTP(
	base: string,
	path: string,
	method: string,
	body: JsonRecord | null,
	accessToken: string,
): Promise<{ data: unknown; statusCode: number }> {
	const url = `${base}${path}`;
	const headers: Record<string, string> = {
		Accept: "application/json",
		Authorization: `Bearer ${accessToken}`,
	};
	if (body) {
		headers["Content-Type"] = "application/json";
	}

	const response = await fetch(url, {
		method,
		headers,
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = await response.text();
	let parsed: unknown = data;
	try {
		parsed = JSON.parse(data);
	} catch {
		// keep raw text
	}
	return { data: parsed, statusCode: response.status };
}

async function fetchCloudId(siteHost: string): Promise<string | null> {
	const cached = cloudIdCache.get(siteHost);
	if (cached) return cached;

	const response = await fetch(`${siteHost}/_edge/tenant_info`, {
		headers: { Accept: "application/json" },
	});
	if (!response.ok) return null;
	const json = (await response.json().catch(() => null)) as JsonRecord | null;
	const cloudId = stringValue(json?.cloudId)?.trim();
	if (!cloudId) return null;
	cloudIdCache.set(siteHost, cloudId);
	return cloudId;
}

function parseErrorMessage(data: unknown): string | undefined {
	if (typeof data === "string") return data || undefined;
	if (data && typeof data === "object" && !Array.isArray(data)) {
		const json = data as JsonRecord;
		const errorMessages = json.errorMessages;
		if (Array.isArray(errorMessages) && typeof errorMessages[0] === "string") {
			return errorMessages[0];
		}
		const errors = json.errors;
		if (errors && typeof errors === "object" && !Array.isArray(errors)) {
			const firstValue = Object.values(errors as JsonRecord)[0];
			const msg = stringValue(firstValue);
			if (msg) return msg;
		}
		const msg = stringValue(json.message);
		if (msg) return msg;
	}
	return undefined;
}

function authFailureMessage(
	siteMessage: string,
	gatewayMessage: string,
): string {
	return `${siteMessage} (site URL). Scoped-token gateway retry also failed: ${gatewayMessage}. Create a new classic API token (without scopes), or a scoped token with Jira read scopes. Confirm the email matches the Atlassian account that owns the token.`;
}

async function resolveOAuthCloudId(
	config: JsonRecord,
	accessToken: string,
): Promise<string> {
	const storedCloudId = getConfigField(config, "cloudId");
	if (storedCloudId) {
		cloudIdCache.set("oauth", storedCloudId);
		return storedCloudId;
	}

	const cached = cloudIdCache.get("oauth");
	if (cached) return cached;

	const resources = await fetchAccessibleResources(accessToken);
	if (resources.length === 0) {
		throw new JiraFailure(
			"No accessible Jira sites found. Ensure your Atlassian app has Jira permissions.",
		);
	}
	const cloudId = resources[0].id;
	cloudIdCache.set("oauth", cloudId);
	return cloudId;
}

async function resolveOAuthAccessToken(config: JsonRecord): Promise<string> {
	const accessToken = getConfigField(config, "oauthAccessToken");
	if (!accessToken) {
		throw new JiraFailure(
			"Jira OAuth access token not found. Run `toby connect jira` to authenticate.",
		);
	}

	const expiresAt = getConfigField(config, "oauthExpiresAt");
	if (!isJiraAccessTokenFresh(expiresAt)) {
		const refreshed = await refreshJiraOAuthAccessToken(config);
		return refreshed.accessToken;
	}

	return accessToken;
}

async function requestOAuth(
	config: JsonRecord,
	path: string,
	method: string,
	body: JsonRecord | null,
): Promise<JsonRecord> {
	let accessToken = await resolveOAuthAccessToken(config);
	const cloudId = await resolveOAuthCloudId(config, accessToken);
	const gatewayHost = buildGatewayHost(cloudId);

	let result = await performOAuthHTTP(
		gatewayHost,
		path,
		method,
		body,
		accessToken,
	);

	// Retry once on 401 by refreshing the token
	if (result.statusCode === 401) {
		const refreshed = await refreshJiraOAuthAccessToken(config);
		accessToken = refreshed.accessToken;
		result = await performOAuthHTTP(
			gatewayHost,
			path,
			method,
			body,
			accessToken,
		);
	}

	if (result.statusCode < 400) {
		return result.data as JsonRecord;
	}

	const message = parseErrorMessage(result.data) ?? `HTTP ${result.statusCode}`;
	throw new JiraFailure(message);
}

async function requestApiToken(
	config: JsonRecord,
	path: string,
	method: string,
	body: JsonRecord | null,
): Promise<JsonRecord> {
	const creds = jiraApiTokenCredentials(config);
	if (!creds) {
		throw new JiraFailure("Jira API token credentials not found.");
	}

	const siteHost = buildHost(creds.domain);
	const cachedBase = apiBaseCache.get(siteHost);
	if (cachedBase) {
		const result = await performApiTokenHTTP(
			cachedBase,
			path,
			method,
			body,
			creds,
		);
		if (result.statusCode < 400) {
			return result.data as JsonRecord;
		}
		const message =
			parseErrorMessage(result.data) ?? `HTTP ${result.statusCode}`;
		throw new JiraFailure(message);
	}

	const siteResult = await performApiTokenHTTP(
		siteHost,
		path,
		method,
		body,
		creds,
	);
	if (siteResult.statusCode < 400) {
		apiBaseCache.set(siteHost, siteHost);
		return siteResult.data as JsonRecord;
	}

	if (
		(siteResult.statusCode === 401 || siteResult.statusCode === 403) &&
		(await fetchCloudId(siteHost))
	) {
		const cloudId = (await fetchCloudId(siteHost)) as string;
		const gatewayHost = buildGatewayHost(cloudId);
		const gatewayResult = await performApiTokenHTTP(
			gatewayHost,
			path,
			method,
			body,
			creds,
		);
		if (gatewayResult.statusCode < 400) {
			apiBaseCache.set(siteHost, gatewayHost);
			return gatewayResult.data as JsonRecord;
		}

		const siteMessage =
			parseErrorMessage(siteResult.data) ?? `HTTP ${siteResult.statusCode}`;
		const gatewayMessage =
			parseErrorMessage(gatewayResult.data) ??
			`HTTP ${gatewayResult.statusCode}`;
		throw new JiraFailure(authFailureMessage(siteMessage, gatewayMessage));
	}

	const message =
		parseErrorMessage(siteResult.data) ?? `HTTP ${siteResult.statusCode}`;
	throw new JiraFailure(message);
}

async function request(
	config: JsonRecord,
	path: string,
	method: string,
	body: JsonRecord | null = null,
): Promise<JsonRecord> {
	const authMethod = getJiraAuthMethod(config);

	if (authMethod === "oauth") {
		if (!hasJiraOAuthToken(config)) {
			throw new JiraFailure(
				"Jira is not authenticated. Run `toby connect jira` to complete OAuth.",
			);
		}
		return requestOAuth(config, path, method, body);
	}

	return requestApiToken(config, path, method, body);
}

export async function testConnection(config: JsonRecord): Promise<void> {
	await request(config, "/rest/api/3/myself", "GET");
}

function extractIssueSummary(fields: JsonRecord): JsonRecord {
	const project = (fields.project ?? {}) as JsonRecord;
	const projectKey = stringValue(project.key) ?? "";
	const projectName = stringValue(project.name) ?? "";
	const projectStr =
		projectKey || projectName ? `${projectKey} - ${projectName}` : "";
	const status = (fields.status ?? {}) as JsonRecord;
	const assignee = (fields.assignee ?? {}) as JsonRecord;
	const priority = (fields.priority ?? {}) as JsonRecord;
	const issuetype = (fields.issuetype ?? {}) as JsonRecord;

	return {
		summary: stringValue(fields.summary) ?? "",
		status: stringValue(status.name) ?? "",
		assignee: stringValue(assignee.displayName) ?? "Unassigned",
		priority: stringValue(priority.name) ?? "",
		issuetype: stringValue(issuetype.name) ?? "",
		project: projectStr,
		updated: stringValue(fields.updated) ?? "",
	};
}

function extractIssueDetail(fields: JsonRecord): JsonRecord {
	const project = (fields.project ?? {}) as JsonRecord;
	const status = (fields.status ?? {}) as JsonRecord;
	const assignee = (fields.assignee ?? {}) as JsonRecord;
	const priority = (fields.priority ?? {}) as JsonRecord;
	const issuetype = (fields.issuetype ?? {}) as JsonRecord;
	const labels = Array.isArray(fields.labels) ? fields.labels : [];

	const detail: JsonRecord = {
		summary: stringValue(fields.summary) ?? "",
		status: stringValue(status.name) ?? "",
		assignee: stringValue(assignee.displayName) ?? "Unassigned",
		priority: stringValue(priority.name) ?? "None",
		issuetype: stringValue(issuetype.name) ?? "",
		labels,
		created: stringValue(fields.created) ?? "",
		updated: stringValue(fields.updated) ?? "",
		description: fields.description ?? null,
	};

	if (fields.project && typeof fields.project === "object") {
		detail.project = {
			key: stringValue(project.key) ?? "",
			name: stringValue(project.name) ?? "",
		};
	} else {
		detail.project = null;
	}

	return detail;
}

export async function searchIssues(
	config: JsonRecord,
	jql: string,
	maxResults = 50,
	nextPageToken?: string,
): Promise<JsonRecord> {
	const body: JsonRecord = {
		jql,
		maxResults: Math.max(1, Math.min(maxResults, 100)),
		fields: SEARCH_FIELDS,
		fieldsByKeys: true,
	};
	if (nextPageToken?.trim()) {
		body.nextPageToken = nextPageToken;
	}

	const json = await request(config, "/rest/api/3/search/jql", "POST", body);
	const rawIssues = (json.issues ?? []) as JsonRecord[];
	const issues = rawIssues.map((issue) => {
		const fields = (issue.fields ?? {}) as JsonRecord;
		const summary = extractIssueSummary(fields);
		summary.key = stringValue(issue.key) ?? "";
		summary.id = stringValue(issue.id) ?? "";
		return summary;
	});

	const result: JsonRecord = {
		ok: true,
		issueCount: issues.length,
		issues,
	};
	const token = stringValue(json.nextPageToken);
	if (token) {
		result.nextPageToken = token;
	}
	return result;
}

export async function getIssue(
	config: JsonRecord,
	issueKey: string,
): Promise<JsonRecord> {
	const encoded = encodeURIComponent(issueKey);
	const json = await request(config, `/rest/api/3/issue/${encoded}`, "GET");
	const fields = (json.fields ?? {}) as JsonRecord;
	const detail = extractIssueDetail(fields);
	detail.ok = true;
	detail.key = stringValue(json.key) ?? issueKey;
	detail.id = stringValue(json.id) ?? "";
	return detail;
}

export async function getIssueComments(
	config: JsonRecord,
	issueKey: string,
	startAt = 0,
	maxResults = 50,
): Promise<JsonRecord> {
	const encoded = encodeURIComponent(issueKey);
	const query = `startAt=${Math.max(0, startAt)}&maxResults=${Math.max(1, Math.min(maxResults, 100))}`;
	const json = await request(
		config,
		`/rest/api/3/issue/${encoded}/comment?${query}`,
		"GET",
	);
	const rawComments = (json.comments ?? []) as JsonRecord[];
	const comments = rawComments.map((comment) => {
		const author = (comment.author ?? {}) as JsonRecord;
		return {
			id: stringValue(comment.id) ?? "",
			author: stringValue(author.displayName) ?? "Unknown",
			created: stringValue(comment.created) ?? "",
			updated: stringValue(comment.updated) ?? "",
			body: comment.body ?? null,
		};
	});

	return {
		ok: true,
		total: intValue(json.total) ?? comments.length,
		startAt: intValue(json.startAt) ?? startAt,
		comments,
	};
}

export async function listProjects(
	config: JsonRecord,
	startAt = 0,
	maxResults = 50,
): Promise<JsonRecord> {
	const query = `startAt=${Math.max(0, startAt)}&maxResults=${Math.max(1, Math.min(maxResults, 100))}`;
	const json = await request(
		config,
		`/rest/api/3/project/search?${query}`,
		"GET",
	);
	const values = (json.values ?? []) as JsonRecord[];
	const projects = values.map((project) => ({
		key: stringValue(project.key) ?? "",
		name: stringValue(project.name) ?? "",
		id: stringValue(project.id) ?? "",
		type: stringValue(project.projectTypeKey) ?? "",
	}));

	return {
		ok: true,
		total: intValue(json.total) ?? projects.length,
		projects,
	};
}
