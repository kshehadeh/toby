import { describe, expect, it } from "vitest";
import {
	isSlackAccessTokenFresh,
	parseSlackOAuthExpiry,
} from "../src/integrations/slack/tokens";

describe("slack token helpers", () => {
	it("parseSlackOAuthExpiry returns ISO timestamp", () => {
		const iso = parseSlackOAuthExpiry(3600);
		expect(iso).toBeDefined();
		expect(Number.isFinite(Date.parse(iso ?? ""))).toBe(true);
	});

	it("isSlackAccessTokenFresh treats missing expiry as fresh", () => {
		expect(isSlackAccessTokenFresh(undefined)).toBe(true);
	});

	it("isSlackAccessTokenFresh detects expired tokens", () => {
		const past = new Date(Date.now() - 120_000).toISOString();
		expect(isSlackAccessTokenFresh(past)).toBe(false);
	});
});
