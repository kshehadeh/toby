const DEFAULT_TOBY_GITHUB_REPO = "kshehadeh/toby";

interface ReleaseResponse {
	tag_name?: string;
}

export function resolveTobyGitHubRepo(optionRepo?: string): string {
	return (
		optionRepo?.trim() ||
		process.env.TOBY_REPO?.trim() ||
		DEFAULT_TOBY_GITHUB_REPO
	);
}

export async function fetchLatestReleaseTag(repo: string): Promise<string> {
	const headers = new Headers({
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	});
	if (process.env.GITHUB_TOKEN) {
		headers.set("Authorization", `Bearer ${process.env.GITHUB_TOKEN}`);
	}

	const response = await fetch(
		`https://api.github.com/repos/${repo}/releases/latest`,
		{ headers },
	);
	if (!response.ok) {
		throw new Error(
			`Failed to resolve latest release for ${repo}: ${response.status} ${response.statusText}`,
		);
	}

	const release = (await response.json()) as ReleaseResponse;
	const tag = release.tag_name?.trim();
	if (!tag) {
		throw new Error(`Could not determine latest release tag for ${repo}.`);
	}
	return tag;
}
