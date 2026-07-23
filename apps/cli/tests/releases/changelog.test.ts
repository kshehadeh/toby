import { describe, expect, it } from "bun:test";
import {
	categorizeChange,
	parseReleaseBody,
	releaseHasChanges,
} from "@toby/core/releases/changelog";

describe("changelog parser", () => {
	describe("categorizeChange", () => {
		it("classifies feat as feature", () => {
			const change = categorizeChange(
				"- feat(app): hide Listen section from settings sidebar (a407cf9)",
			);
			expect(change).toEqual({
				type: "feature",
				scope: "app",
				description: "hide Listen section from settings sidebar",
				sha: "a407cf9",
			});
		});

		it("classifies fix as bug", () => {
			const change = categorizeChange(
				"- fix(app): keep chat title clear of traffic lights (d6f0323)",
			);
			expect(change?.type).toBe("bug");
			expect(change?.scope).toBe("app");
		});

		it("classifies perf/refactor/style/build/ci/test/chore as enhancement", () => {
			const cases = [
				"- perf(core): cache model results",
				"- refactor(cli): split commands into files",
				"- style: reformat package.json",
				"- build(app): support development and production app variants",
				"- ci: update release workflow",
				"- test(chat): cover follow-up session history",
				"- chore(app): ignore SwiftPM Xcode user data",
			];
			for (const line of cases) {
				expect(categorizeChange(line)?.type).toBe("enhancement");
			}
		});

		it("excludes docs", () => {
			expect(
				categorizeChange("- docs: update architecture diagrams"),
			).toBeNull();
		});

		it("excludes release commits", () => {
			expect(
				categorizeChange("- chore(release): v0.49.0 (07d1f36)"),
			).toBeNull();
		});

		it("excludes merge-only lines", () => {
			expect(
				categorizeChange(
					"- Merge pull request #7 from kshehadeh/codex/update-architecture-diagrams",
				),
			).toBeNull();
		});

		it("excludes full changelog/diff links", () => {
			expect(
				categorizeChange("[Full diff](https://github.com/.../compare/..."),
			).toBeNull();
			expect(
				categorizeChange(
					"**Full Changelog**: https://github.com/.../compare/...",
				),
			).toBeNull();
		});

		it("treats non-conventional bullets as enhancements", () => {
			const change = categorizeChange("- Improved onboarding flow");
			expect(change?.type).toBe("enhancement");
			expect(change?.description).toBe("Improved onboarding flow");
		});

		it("strips GitHub auto-generated changelog suffixes", () => {
			const change = categorizeChange(
				"- fix(docs): document daemon-backed local app surfaces by @kshehadeh in https://github.com/kshehadeh/toby/pull/7",
			);
			expect(change).toBeNull();
		});

		it("strips GitHub auto-generated suffixes and keeps the description", () => {
			const change = categorizeChange(
				"- fix(app): document daemon-backed local app surfaces by @kshehadeh in https://github.com/kshehadeh/toby/pull/7",
			);
			expect(change).toEqual({
				type: "bug",
				scope: "app",
				description: "document daemon-backed local app surfaces",
				sha: undefined,
			});
		});
	});

	describe("parseReleaseBody", () => {
		it("groups conventional commit bullets into features, bugs, and enhancements", () => {
			const body = [
				"## Changes since v0.48.0",
				"",
				"- chore(release): v0.49.0 (07d1f36)",
				"- chore(app): ignore SwiftPM Xcode user data (1b0ac89)",
				"- feat(app): hide Listen section from settings sidebar (a407cf9)",
				"- feat(app): add permissions window and menu item (9105939)",
				"- fix(app): keep chat title clear of traffic lights when sidebar collapsed (d6f0323)",
				"- build(app): support development and production app variants (236972e)",
				"- docs: update architecture diagrams",
				"- Merge pull request #14 from kshehadeh/feature/listen",
				"",
				"[Full diff](https://github.com/kshehadeh/toby/compare/v0.48.0...v0.49.0)",
			].join("\n");

			const release = parseReleaseBody(
				"v0.49.0",
				"v0.49.0",
				"https://github.com/kshehadeh/toby/releases/tag/v0.49.0",
				"2026-06-19T09:43:31Z",
				body,
			);

			expect(release.features).toHaveLength(2);
			expect(release.features[0]?.description).toBe(
				"hide Listen section from settings sidebar",
			);
			expect(release.bugs).toHaveLength(1);
			expect(release.bugs[0]?.description).toBe(
				"keep chat title clear of traffic lights when sidebar collapsed",
			);
			expect(release.enhancements).toHaveLength(2);
			expect(release.enhancements[0]?.description).toBe(
				"ignore SwiftPM Xcode user data",
			);
			expect(release.enhancements[1]?.description).toBe(
				"support development and production app variants",
			);
		});
	});

	describe("releaseHasChanges", () => {
		it("returns true when any group is non-empty", () => {
			expect(
				releaseHasChanges({
					version: "v1",
					tagName: "v1",
					url: "",
					publishedAt: "",
					features: [{ type: "feature", description: "x" }],
					bugs: [],
					enhancements: [],
				}),
			).toBe(true);
		});

		it("returns false when all groups are empty", () => {
			expect(
				releaseHasChanges({
					version: "v1",
					tagName: "v1",
					url: "",
					publishedAt: "",
					features: [],
					bugs: [],
					enhancements: [],
				}),
			).toBe(false);
		});
	});
});
