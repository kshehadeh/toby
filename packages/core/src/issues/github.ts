import { getTobyVersion } from "../version";

export type IssueType = "bug" | "feature";

export interface IssueMetadata {
	readonly version?: string;
	readonly platform?: string;
	readonly source?: "tui" | "native-app";
}

export interface CreateIssueInput {
	readonly repo?: string;
	readonly type: IssueType;
	readonly details: string;
	readonly metadata?: IssueMetadata;
}

export interface CreateIssueSuccess {
	readonly ok: true;
	readonly url: string;
	readonly number: number;
}

export interface CreateIssueFallback {
	readonly ok: false;
	readonly fallbackUrl: string;
	readonly reason: string;
}

export type CreateIssueResult = CreateIssueSuccess | CreateIssueFallback;

const DEFAULT_TOBY_GITHUB_REPO = "kshehadeh/toby";
const ISSUE_TITLE_MAX_LENGTH = 80;

interface GitHubIssueResponse {
	html_url?: string;
	number?: number;
	message?: string;
}

export function resolveGitHubRepo(optionRepo?: string): string {
	return (
		optionRepo?.trim() ||
		process.env.TOBY_REPO?.trim() ||
		DEFAULT_TOBY_GITHUB_REPO
	);
}

export function resolveGitHubToken(): string | undefined {
	return process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
}

export function buildIssueTitle(input: CreateIssueInput): string {
	const firstLine = input.details.split("\n")[0]?.trim().replace(/\s+/g, " ");
	const prefix = `[${input.type}]`;
	if (!firstLine) {
		return `${prefix} ${capitalize(input.type)} report`;
	}
	const available = Math.max(10, ISSUE_TITLE_MAX_LENGTH - prefix.length - 1);
	const title =
		firstLine.length > available
			? `${firstLine.slice(0, available - 1)}…`
			: firstLine;
	return `${prefix} ${title}`;
}

export function buildIssueBody(input: CreateIssueInput): string {
	const metadata = input.metadata ?? {};
	const lines = [
		"## Description",
		"",
		input.details.trim(),
		"",
		"## Metadata",
		"",
		`- **Type:** ${input.type}`,
		`- **Version:** ${metadata.version ?? getTobyVersion()}`,
		`- **Platform:** ${metadata.platform ?? guessPlatform()}`,
	];
	if (metadata.source) {
		lines.push(`- **Reported from:** ${metadata.source}`);
	}
	return lines.join("\n");
}

export function buildFallbackIssueUrl(input: CreateIssueInput): string {
	const repo = resolveGitHubRepo(input.repo);
	const params = new URLSearchParams({
		title: buildIssueTitle(input),
		body: buildIssueBody(input),
		labels: input.type,
	});
	return `https://github.com/${repo}/issues/new?${params.toString()}`;
}

export async function createGitHubIssue(
	input: CreateIssueInput,
): Promise<CreateIssueResult> {
	const token = resolveGitHubToken();
	if (!token) {
		return {
			ok: false,
			fallbackUrl: buildFallbackIssueUrl(input),
			reason: "GITHUB_TOKEN is not set. Opened a pre-filled issue URL instead.",
		};
	}

	const repo = resolveGitHubRepo(input.repo);
	const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
		method: "POST",
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${token}`,
			"X-GitHub-Api-Version": "2022-11-28",
		},
		body: JSON.stringify({
			title: buildIssueTitle(input),
			body: buildIssueBody(input),
			labels: [input.type],
		}),
	});

	if (!response.ok) {
		const raw = (await response
			.json()
			.catch(() => ({}))) as GitHubIssueResponse;
		return {
			ok: false,
			fallbackUrl: buildFallbackIssueUrl(input),
			reason: `GitHub API returned ${response.status}: ${raw.message ?? response.statusText}`,
		};
	}

	const json = (await response.json()) as GitHubIssueResponse;
	const url = json.html_url?.trim();
	const number = json.number;
	if (!url || typeof number !== "number") {
		return {
			ok: false,
			fallbackUrl: buildFallbackIssueUrl(input),
			reason:
				"GitHub response missing issue URL; opened a pre-filled issue URL instead.",
		};
	}

	return { ok: true, url, number };
}

function capitalize(value: string): string {
	return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

function guessPlatform(): string {
	if (typeof process === "undefined") return "unknown";
	return `${process.platform} ${process.arch}`;
}
