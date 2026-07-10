import type React from "react";
import { useEffect, useState } from "react";

/** Direct asset from the latest GitHub release (Apple Silicon DMG). */
export const TOBY_DMG_DOWNLOAD_URL =
	"https://github.com/kshehadeh/toby/releases/latest/download/Toby-arm64.dmg";

const LATEST_RELEASE_API =
	"https://api.github.com/repos/kshehadeh/toby/releases/latest";

type DownloadTobyButtonProps = {
	readonly className?: string;
	/** Infima size: large (default) or normal. */
	readonly size?: "lg" | "md";
};

/**
 * Primary install CTA. Fetches the latest release tag from GitHub so the
 * button can show the current version (falls back if the request fails).
 */
export default function DownloadTobyButton({
	className,
	size = "lg",
}: DownloadTobyButtonProps): React.JSX.Element {
	const [version, setVersion] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;

		fetch(LATEST_RELEASE_API, {
			headers: {
				Accept: "application/vnd.github+json",
			},
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

	const sizeClass = size === "lg" ? "button--lg" : undefined;
	const classes = [
		"button",
		"button--primary",
		"downloadTobyButton",
		sizeClass,
		className,
	]
		.filter(Boolean)
		.join(" ");

	return (
		<a className={classes} href={TOBY_DMG_DOWNLOAD_URL}>
			{label}
		</a>
	);
}
