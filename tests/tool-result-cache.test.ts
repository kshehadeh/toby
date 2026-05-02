import { describe, expect, it } from "vitest";
import {
	buildToolResultCacheKey,
	clearToolResultCache,
	getCachedToolResult,
	isReadOnlyChatTool,
	setCachedToolResult,
} from "../src/chat-pipeline/tool-result-cache";

describe("tool-result-cache", () => {
	it("builds stable keys regardless object property order", () => {
		const a = buildToolResultCacheKey("listUsers", { q: "sam", top: 5 });
		const b = buildToolResultCacheKey("listUsers", { top: 5, q: "sam" });
		expect(a).toBe(b);
	});

	it("stores and retrieves cached values before TTL", () => {
		clearToolResultCache();
		setCachedToolResult("listUsers", { q: "sam" }, { users: [1] }, 300_000, 10);
		const hit = getCachedToolResult("listUsers", { q: "sam" }, 20);
		expect(hit.hit).toBe(true);
		expect(hit.value).toEqual({ users: [1] });
	});

	it("expires cached values after TTL", () => {
		clearToolResultCache();
		setCachedToolResult("listUsers", { q: "sam" }, { users: [1] }, 5, 10);
		const miss = getCachedToolResult("listUsers", { q: "sam" }, 16);
		expect(miss.hit).toBe(false);
	});

	it("clears cache and returns cleared entry count", () => {
		clearToolResultCache();
		setCachedToolResult("listUsers", { q: "sam" }, { users: [1] });
		setCachedToolResult("listLabels", {}, { labels: [1] });
		expect(clearToolResultCache()).toBe(2);
		expect(getCachedToolResult("listUsers", { q: "sam" }).hit).toBe(false);
	});

	it("marks only read-only tools as cacheable", () => {
		expect(isReadOnlyChatTool("listLabels")).toBe(true);
		expect(isReadOnlyChatTool("listProjectNames")).toBe(true);
		expect(isReadOnlyChatTool("getProjectNameById")).toBe(true);
		expect(isReadOnlyChatTool("completeTask")).toBe(false);
		expect(isReadOnlyChatTool("askUser")).toBe(false);
	});
});
