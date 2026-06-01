/** Monorepo root `package.json` — canonical Toby release version (not `@toby/core`). */
import packageJson from "../../../package.json";

export function getTobyVersion(): string {
	const envVersion = process.env.TOBY_VERSION?.trim();
	if (envVersion) {
		return envVersion;
	}
	const packageVersion =
		typeof packageJson.version === "string" ? packageJson.version.trim() : "";
	return packageVersion || "0.1.0";
}

export function normalizeReleaseVersion(tag: string): string {
	const trimmed = tag.trim();
	return trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
}

export function compareVersions(left: string, right: string): -1 | 0 | 1 {
	const leftParts = normalizeReleaseVersion(left)
		.split(".")
		.map((part) => Number.parseInt(part, 10) || 0);
	const rightParts = normalizeReleaseVersion(right)
		.split(".")
		.map((part) => Number.parseInt(part, 10) || 0);
	const length = Math.max(leftParts.length, rightParts.length);
	for (let index = 0; index < length; index += 1) {
		const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
		if (diff < 0) {
			return -1;
		}
		if (diff > 0) {
			return 1;
		}
	}
	return 0;
}

export function isVersionNewer(latest: string, current: string): boolean {
	return compareVersions(latest, current) > 0;
}
