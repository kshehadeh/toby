import { resolveTobyGitHubRepo } from "./github";

export type ChangelogChangeType = "feature" | "bug" | "enhancement";

export interface ChangelogChange {
	type: ChangelogChangeType;
	scope?: string;
	description: string;
	sha?: string;
}

export interface ChangelogRelease {
	version: string;
	tagName: string;
	url: string;
	publishedAt: string;
	features: ChangelogChange[];
	bugs: ChangelogChange[];
	enhancements: ChangelogChange[];
}

export interface ChangelogResponse {
	releases: ChangelogRelease[];
}

interface GitHubRelease {
	tag_name: string;
	name: string;
	body: string | null;
	html_url: string;
	published_at: string;
}

const CHANGE_TYPES: Record<string, ChangelogChangeType> = {
	feat: "feature",
	fix: "bug",
	perf: "enhancement",
	refactor: "enhancement",
	style: "enhancement",
	build: "enhancement",
	ci: "enhancement",
	test: "enhancement",
	chore: "enhancement",
};

const EXCLUDED_TYPES = new Set(["docs"]);

const RELEASE_COMMIT_RE = /^chore\(release\):\s*v/i;
const MERGE_LINE_RE = /^(merge pull request|merge branch)/i;
const FULL_DIFF_RE = /^(\[full diff\]|\*\*full changelog\*\*|\[compare)/i;
const EMPTY_BULLET_RE = /^[-*]\s*$/;
const SHA_RE = /\(([0-9a-f]{7,40})\)$/;

export function categorizeChange(raw: string): ChangelogChange | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;

	// Strip leading bullet markers and whitespace (require a space after the marker).
	let text = trimmed.replace(/^[\s]*[-*]\s+/, "");
	if (!text) return null;

	// Drop markdown headers, merge-only lines, full diff/changelog links, and what's-changed headers.
	if (
		/^#{1,6}\s/.test(text) ||
		MERGE_LINE_RE.test(text) ||
		FULL_DIFF_RE.test(text) ||
		EMPTY_BULLET_RE.test(trimmed) ||
		/^what's changed/i.test(text) ||
		/^new contributors/i.test(text)
	) {
		return null;
	}

	// Strip GitHub auto-generated changelog suffixes like "by @user in https://...".
	text = text.replace(/\s+by\s+@[\w-]+\s+in\s+https?:\/\/\S+$/i, "");

	// Parse conventional commit form: type(scope): description
	const match = /^(\w+)(?:\(([^)]*)\))?:\s*(.+)$/.exec(text);
	if (!match) {
		// Non-conventional bullets are treated as enhancements if they look substantive.
		return {
			type: "enhancement",
			description: text,
		};
	}

	const [, type, scope, rawDescription] = match;
	const lowerType = type.toLowerCase();

	if (EXCLUDED_TYPES.has(lowerType)) return null;
	if (scope?.toLowerCase() === "docs") return null;
	if (lowerType === "chore" && RELEASE_COMMIT_RE.test(text)) return null;

	const mappedType = CHANGE_TYPES[lowerType];
	if (!mappedType) return null;

	const shaMatch = SHA_RE.exec(rawDescription);
	const sha = shaMatch ? shaMatch[1] : undefined;
	const description = rawDescription
		.trim()
		.replace(/\s+\([0-9a-f]{7,40}\)\s*$/i, "");

	return {
		type: mappedType,
		scope,
		description,
		sha,
	};
}

export function parseReleaseBody(
	version: string,
	tagName: string,
	url: string,
	publishedAt: string,
	body: string,
): ChangelogRelease {
	const features: ChangelogChange[] = [];
	const bugs: ChangelogChange[] = [];
	const enhancements: ChangelogChange[] = [];

	for (const line of body.split("\n")) {
		const change = categorizeChange(line);
		if (!change) continue;

		switch (change.type) {
			case "feature":
				features.push(change);
				break;
			case "bug":
				bugs.push(change);
				break;
			case "enhancement":
				enhancements.push(change);
				break;
		}
	}

	return {
		version,
		tagName,
		url,
		publishedAt,
		features,
		bugs,
		enhancements,
	};
}

export async function fetchChangelog(
	options: { repo?: string; limit?: number } = {},
): Promise<ChangelogResponse> {
	const repo = resolveTobyGitHubRepo(options.repo);
	const limit = Math.min(Math.max(options.limit ?? 10, 1), 10);

	const headers = new Headers({
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	});
	if (process.env.GITHUB_TOKEN) {
		headers.set("Authorization", `Bearer ${process.env.GITHUB_TOKEN}`);
	}

	const response = await fetch(
		`https://api.github.com/repos/${repo}/releases?per_page=${limit}`,
		{ headers },
	);
	if (!response.ok) {
		throw new Error(
			`Failed to fetch changelog for ${repo}: ${response.status} ${response.statusText}`,
		);
	}

	const releases = (await response.json()) as GitHubRelease[];
	const parsed: ChangelogRelease[] = [];

	for (const release of releases) {
		const body = release.body ?? "";
		const parsedRelease = parseReleaseBody(
			release.tag_name,
			release.tag_name,
			release.html_url,
			release.published_at,
			body,
		);
		parsed.push(parsedRelease);
	}

	return { releases: parsed };
}

export function releaseHasChanges(release: ChangelogRelease): boolean {
	return (
		release.features.length > 0 ||
		release.bugs.length > 0 ||
		release.enhancements.length > 0
	);
}
