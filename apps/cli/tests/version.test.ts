import {
	compareVersions,
	isVersionNewer,
	normalizeReleaseVersion,
} from "@toby/core/version";
import { describe, expect, it } from "bun:test";

describe("version", () => {
	it("normalizes release tags", () => {
		expect(normalizeReleaseVersion("v1.2.3")).toBe("1.2.3");
		expect(normalizeReleaseVersion("1.2.3")).toBe("1.2.3");
	});

	it("compares semantic versions", () => {
		expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
		expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
		expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
	});

	it("detects newer releases", () => {
		expect(isVersionNewer("1.0.1", "1.0.0")).toBe(true);
		expect(isVersionNewer("1.0.0", "1.0.0")).toBe(false);
		expect(isVersionNewer("0.9.9", "1.0.0")).toBe(false);
	});
});
