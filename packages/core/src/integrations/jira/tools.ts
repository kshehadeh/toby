import { tool } from "ai";
import { z } from "zod";
import {
	getIssue,
	getIssueComments,
	listProjects,
	searchIssues,
} from "./client";

interface JiraToolContext {
	dryRun: boolean;
	appliedActions: string[];
}

export function createJiraTools(ctx: JiraToolContext) {
	return {
		searchJiraIssues: tool({
			description:
				"Search Jira issues using JQL (Jira Query Language). Returns matching issues with key, summary, status, assignee, and priority. Use JQL syntax like: assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC",
			inputSchema: z.object({
				jql: z
					.string()
					.min(1)
					.describe(
						"JQL query string. Examples: 'project = PROJ', 'assignee = currentUser() AND status != Done', 'key = PROJ-123'",
					),
				maxResults: z
					.number()
					.int()
					.min(1)
					.max(100)
					.optional()
					.describe("Maximum issues to return (1-100, default 50)"),
				nextPageToken: z
					.string()
					.optional()
					.describe(
						"Token for fetching the next page of results (from previous search response)",
					),
			}),
			execute: async ({ jql, maxResults, nextPageToken }) => {
				if (ctx.dryRun) {
					const msg = `[DRY RUN] Would search Jira with JQL: "${jql}"`;
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg, jql };
				}

				const response = await searchIssues(jql, {
					maxResults: maxResults ?? 50,
					nextPageToken,
				});

				const msg = `Jira search: "${jql}" — ${response.issues.length} result(s)`;
				ctx.appliedActions.push(msg);

				return {
					ok: true,
					issueCount: response.issueCount,
					nextPageToken: response.nextPageToken,
					issues: response.issues,
				};
			},
		}),

		getJiraIssue: tool({
			description:
				"Get full details of a Jira issue by its key (e.g. PROJ-123). Returns summary, description, status, assignee, priority, labels, and more.",
			inputSchema: z.object({
				issueKey: z.string().min(1).describe("Jira issue key, e.g. PROJ-123"),
			}),
			execute: async ({ issueKey }) => {
				if (ctx.dryRun) {
					const msg = `[DRY RUN] Would fetch Jira issue "${issueKey}"`;
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg, issueKey };
				}

				const issue = await getIssue(issueKey);
				const msg = `Fetched Jira issue "${issueKey}"`;
				ctx.appliedActions.push(msg);

				return {
					ok: true,
					...issue,
				};
			},
		}),

		getJiraIssueComments: tool({
			description:
				"Get comments for a Jira issue by its key. Returns paginated comments with author, body, and timestamps.",
			inputSchema: z.object({
				issueKey: z.string().min(1).describe("Jira issue key, e.g. PROJ-123"),
				maxResults: z
					.number()
					.int()
					.min(1)
					.max(100)
					.optional()
					.describe("Maximum comments to return (1-100, default 50)"),
				startAt: z
					.number()
					.int()
					.min(0)
					.optional()
					.describe("Offset for pagination (default 0)"),
			}),
			execute: async ({ issueKey, maxResults, startAt }) => {
				if (ctx.dryRun) {
					const msg = `[DRY RUN] Would fetch comments for Jira issue "${issueKey}"`;
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg, issueKey };
				}

				const response = await getIssueComments(issueKey, {
					maxResults: maxResults ?? 50,
					startAt: startAt ?? 0,
				});

				const msg = `Fetched ${response.comments.length}/${response.total} comment(s) for Jira issue "${issueKey}"`;
				ctx.appliedActions.push(msg);

				return {
					ok: true,
					total: response.total,
					startAt: response.startAt,
					comments: response.comments,
				};
			},
		}),

		listJiraProjects: tool({
			description:
				"List Jira projects accessible to the authenticated user. Returns project key, name, lead, and type.",
			inputSchema: z.object({
				maxResults: z
					.number()
					.int()
					.min(1)
					.max(100)
					.optional()
					.describe("Maximum projects to return (1-100, default 50)"),
				startAt: z
					.number()
					.int()
					.min(0)
					.optional()
					.describe("Offset for pagination (default 0)"),
			}),
			execute: async ({ maxResults, startAt }) => {
				if (ctx.dryRun) {
					const msg = "[DRY RUN] Would list Jira projects";
					ctx.appliedActions.push(msg);
					return { dryRun: true, message: msg };
				}

				const response = await listProjects({
					maxResults: maxResults ?? 50,
					startAt: startAt ?? 0,
				});

				const msg = `Fetched ${response.projects.length}/${response.total} Jira project(s)`;
				ctx.appliedActions.push(msg);

				return {
					ok: true,
					total: response.total,
					projects: response.projects,
				};
			},
		}),
	};
}
