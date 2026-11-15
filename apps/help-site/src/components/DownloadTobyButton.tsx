"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { buttonClass } from "./Button";

/** Direct asset from the latest GitHub release (Apple Silicon DMG). */
export const TOBY_DMG_DOWNLOAD_URL =
	"https://github.com/kshehadeh/toby/releases/latest/download/Toby-arm64.dmg";

const LATEST_RELEASE_API =
	"https://api.github.com/repos/kshehadeh/toby/releases/latest";

/** Latest release version without the `v` prefix, or null until known. */
export function useLatestVersion(): string | null {
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

	return version;
}

type DownloadTobyButtonProps = {
	readonly className?: string;
	readonly size?: "sm" | "md" | "lg";
	readonly variant?: "accent" | "primary";
	/** Short label ("Download") for tight spaces such as the navbar. */
	readonly compact?: boolean;
};

/**
 * Primary install CTA. Fetches the latest release tag from GitHub so the
 * button can show the current version (falls back if the request fails).
 */
export function DownloadTobyButton({
	className,
	size = "lg",
	variant = "accent",
	compact = false,
}: DownloadTobyButtonProps) {
	const version = useLatestVersion();
	const label = compact
		? "Download"
		: version
			? `Download Toby v${version}`
			: "Download Toby for macOS";

	return (
		<a
			href={TOBY_DMG_DOWNLOAD_URL}
			className={buttonClass(variant, size, className)}
		>
			<Download aria-hidden size={size === "sm" ? 14 : 16} strokeWidth={2.2} />
			{label}
		</a>
	);
}
