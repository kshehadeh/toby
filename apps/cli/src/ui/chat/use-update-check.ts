import { useEffect, useState } from "react";
import {
	fetchLatestReleaseTag,
	resolveTobyGitHubRepo,
} from "../../releases/github";
import {
	getTobyVersion,
	isVersionNewer,
	normalizeReleaseVersion,
} from "../../version";

const DEFAULT_INITIAL_DELAY_MS = 5_000;
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type TobyUpdateInfo = {
	readonly latestVersion: string;
	readonly latestTag: string;
};

export function formatUpdateStatusLine(info: TobyUpdateInfo): string {
	return `Update available: v${info.latestVersion} · /upgrade`;
}

type UseUpdateCheckOptions = {
	readonly enabled?: boolean;
	readonly initialDelayMs?: number;
	readonly intervalMs?: number;
};

export function useUpdateCheck(
	options: UseUpdateCheckOptions = {},
): TobyUpdateInfo | null {
	const { enabled = true, initialDelayMs, intervalMs } = options;
	const [update, setUpdate] = useState<TobyUpdateInfo | null>(null);

	useEffect(() => {
		if (!enabled || process.env.TOBY_SKIP_UPDATE_CHECK === "1") {
			return;
		}

		let cancelled = false;

		const check = async () => {
			try {
				const repo = resolveTobyGitHubRepo();
				const latestTag = await fetchLatestReleaseTag(repo);
				const latestVersion = normalizeReleaseVersion(latestTag);
				const currentVersion = getTobyVersion();
				if (!cancelled && isVersionNewer(latestVersion, currentVersion)) {
					setUpdate({ latestVersion, latestTag });
				}
			} catch {
				// Background checks should not interrupt chat.
			}
		};

		const initialTimer = setTimeout(() => {
			void check();
		}, initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS);
		const intervalTimer = setInterval(() => {
			void check();
		}, intervalMs ?? DEFAULT_INTERVAL_MS);

		return () => {
			cancelled = true;
			clearTimeout(initialTimer);
			clearInterval(intervalTimer);
		};
	}, [enabled, initialDelayMs, intervalMs]);

	return update;
}
