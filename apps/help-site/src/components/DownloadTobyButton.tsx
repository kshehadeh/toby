"use client";

import { useEffect, useState } from "react";

/** Direct asset from the latest GitHub release (Apple Silicon DMG). */
export const TOBY_DMG_DOWNLOAD_URL =
	"https://github.com/kshehadeh/toby/releases/latest/download/Toby-arm64.dmg";

const LATEST_RELEASE_API =
	"https://api.github.com/repos/kshehadeh/toby/releases/latest";

type DownloadTobyButtonProps = {
	readonly className?: string;
	readonly size?: "lg" | "md";
};

/**
 * Primary install CTA. Fetches the latest release tag from GitHub so the
 * button can show the current version (falls back if the request fails).
 */
export function DownloadTobyButton({
	className,
	size = "lg",
}: DownloadTobyButtonProps) {
	const [version, setVersion] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		fetch(LATEST_RELEASE_API, {
			headers: { Accept: "application/vnd.github+json" },
		})
			.then((response) => (response.ok ? response.json() : null))
			.then((data: { tag_name?: string } | null) => {
				if (cancelled || !data?.tag_name) return;
				const tag = String(data.tag_name).replace(/^v/i, "").trim();
				if (tag) setVersion(tag);
			})
			.catch(() => {
				/* keep fallback label */
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const label = version
		? `⬇ Download Toby v${version}`
		: "⬇ Download Toby for macOS";
	const sizeClass =
		size === "lg" ? "px-9 py-[0.5625rem] text-xl" : "px-6 py-1.5 text-sm";

	return (
		<a
			href={TOBY_DMG_DOWNLOAD_URL}
			className={`inline-block rounded-lg border border-accent bg-accent text-center font-bold leading-normal text-fg no-underline transition-colors hover:border-accent-dim hover:bg-accent-dim hover:text-fg ${sizeClass} ${className ?? ""}`}
		>
			{label}
		</a>
	);
}
