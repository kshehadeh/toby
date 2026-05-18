import { spawnSync } from "node:child_process";

export const DEFAULT_TOBY_GITHUB_REPO = "kshehadeh/toby";

interface ReleaseResponse {
	tag_name?: string;
}

export function resolveTobyGitHubRepo(optionRepo?: string): string {
	return (
		optionRepo?.trim() ||
		process.env.TOBY_REPO?.trim() ||
		detectRepoFromGitRemote() ||
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

function detectRepoFromGitRemote(): string | null {
	const rootResult = spawnSync("git", ["rev-parse", "--show-toplevel"], {
		encoding: "utf8",
	});
	if (rootResult.status !== 0) {
		return null;
	}
	const root = rootResult.stdout.trim();
	if (!root) {
		return null;
	}

	const remoteResult = spawnSync(
		"git",
		["-C", root, "config", "--get", "remote.origin.url"],
		{ encoding: "utf8" },
	);
	if (remoteResult.status !== 0) {
		return null;
	}

	return parseGitHubRepo(remoteResult.stdout.trim());
}

function parseGitHubRepo(remoteUrl: string): string | null {
	if (remoteUrl.startsWith("git@github.com:")) {
		return remoteUrl.replace("git@github.com:", "").replace(/\.git$/, "");
	}
	if (remoteUrl.startsWith("https://github.com/")) {
		return remoteUrl.replace("https://github.com/", "").replace(/\.git$/, "");
	}
	return null;
}
