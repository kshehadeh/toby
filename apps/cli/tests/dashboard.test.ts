import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	clearDashboardCache,
	getDashboardCategory,
	getDashboardData,
} from "@toby/core/dashboard";
import { validateDashboardSummary } from "@toby/core/dashboard/schema";
import { getIntegrationModules } from "@toby/core/integrations/index";
import { resetPluginModuleCache } from "@toby/core/integrations/plugins/registry";

const validSummary = {
	count: 5,
	items: [
		{
			id: "msg-1",
			title: "Test message",
			subtitle: "sender@example.com",
			detail: "A snippet",
			timestamp: "2026-07-05T10:00:00Z",
			urgency: "high",
		},
	],
	groups: [{ id: "inbox", label: "Inbox", count: 5 }],
	generatedAt: "2026-07-05T11:00:00Z",
};

describe("dashboard schema validation", () => {
	it("accepts a valid DashboardSummaryResult", () => {
		const result = validateDashboardSummary(validSummary, "test-plugin");
		expect(result).not.toBeNull();
		expect(result?.count).toBe(5);
		expect(result?.items.length).toBe(1);
		expect(result?.groups?.length).toBe(1);
	});

	it("accepts a summary without optional fields", () => {
		const result = validateDashboardSummary(
			{
				count: 3,
				items: [{ id: "1", title: "Task" }],
				generatedAt: "2026-07-05T11:00:00Z",
			},
			"test-plugin",
		);
		expect(result).not.toBeNull();
		expect(result?.groups).toBeUndefined();
	});

	it("rejects a summary missing required count", () => {
		const result = validateDashboardSummary(
			{
				items: [],
				generatedAt: "2026-07-05T11:00:00Z",
			},
			"test-plugin",
		);
		expect(result).toBeNull();
	});

	it("rejects a summary missing required items", () => {
		const result = validateDashboardSummary(
			{
				count: 5,
				generatedAt: "2026-07-05T11:00:00Z",
			},
			"test-plugin",
		);
		expect(result).toBeNull();
	});

	it("rejects a summary missing required generatedAt", () => {
		const result = validateDashboardSummary(
			{
				count: 5,
				items: [],
			},
			"test-plugin",
		);
		expect(result).toBeNull();
	});

	it("rejects a summary with invalid urgency value", () => {
		const result = validateDashboardSummary(
			{
				count: 1,
				items: [{ id: "1", title: "Test", urgency: "critical" }],
				generatedAt: "2026-07-05T11:00:00Z",
			},
			"test-plugin",
		);
		expect(result).toBeNull();
	});

	it("rejects non-object input", () => {
		expect(validateDashboardSummary("not an object", "test")).toBeNull();
		expect(validateDashboardSummary(null, "test")).toBeNull();
		expect(validateDashboardSummary(undefined, "test")).toBeNull();
		expect(validateDashboardSummary(42, "test")).toBeNull();
	});
});

describe("dashboard aggregator", () => {
	beforeEach(() => {
		clearDashboardCache();
	});

	afterEach(() => {
		clearDashboardCache();
		resetPluginModuleCache();
	});

	it("returns well-formed data with valid structure", async () => {
		// This test verifies the aggregator returns a valid DashboardData
		// structure regardless of which plugins are connected in the test
		// environment. Categories may be null or populated.
		const data = await getDashboardData({ limit: 5 });
		expect(data).toBeDefined();
		expect(data).toHaveProperty("email");
		expect(data).toHaveProperty("tasks");
		expect(data).toHaveProperty("calendar");

		// If a category is populated, verify its structure
		if (data.email) {
			expect(data.email).toHaveProperty("count");
			expect(data.email).toHaveProperty("sources");
			expect(data.email).toHaveProperty("items");
			expect(data.email).toHaveProperty("groups");
			expect(data.email).toHaveProperty("generatedAt");
			expect(typeof data.email.count).toBe("number");
			expect(Array.isArray(data.email.sources)).toBe(true);
			expect(Array.isArray(data.email.items)).toBe(true);
		}
		if (data.tasks) {
			expect(data.tasks).toHaveProperty("count");
			expect(data.tasks).toHaveProperty("sources");
			expect(data.tasks).toHaveProperty("items");
			expect(data.tasks).toHaveProperty("groups");
			expect(data.tasks).toHaveProperty("generatedAt");
			expect(typeof data.tasks.count).toBe("number");
			expect(Array.isArray(data.tasks.sources)).toBe(true);
			expect(Array.isArray(data.tasks.items)).toBe(true);
			// Merged items are tagged with their source provider name.
			for (const item of data.tasks.items) {
				expect(typeof item.providerName).toBe("string");
			}
		}
		if (data.calendar) {
			expect(data.calendar).toHaveProperty("count");
			expect(data.calendar).toHaveProperty("sources");
			expect(data.calendar).toHaveProperty("items");
			expect(data.calendar).toHaveProperty("groups");
			expect(data.calendar).toHaveProperty("generatedAt");
			expect(typeof data.calendar.count).toBe("number");
			expect(Array.isArray(data.calendar.sources)).toBe(true);
			expect(Array.isArray(data.calendar.items)).toBe(true);
			for (const item of data.calendar.items) {
				expect(typeof item.providerName).toBe("string");
			}
		}
	}, 30_000);

	it("caches category results within TTL window", async () => {
		// Use the tasks category (fast, no IMAP dependency) to verify caching.
		const first = await getDashboardCategory("tasks", { limit: 5 });
		const second = await getDashboardCategory("tasks", { limit: 5 });
		// Same reference means the cache was used.
		expect(second).toBe(first);
	}, 15_000);

	it("returns fresh data after cache is cleared", async () => {
		const first = await getDashboardCategory("tasks", { limit: 5 });
		clearDashboardCache();
		const second = await getDashboardCategory("tasks", { limit: 5 });
		// Different reference means the cache was bypassed.
		if (first === null) {
			expect(second).toBeNull();
		} else {
			expect(second).not.toBe(first);
		}
	}, 15_000);

	it("force bypasses category cache without clearing", async () => {
		const first = await getDashboardCategory("tasks", { limit: 5 });
		const soft = await getDashboardCategory("tasks", { limit: 5 });
		expect(soft).toBe(first);
		const forced = await getDashboardCategory("tasks", {
			limit: 5,
			force: true,
		});
		// Re-aggregate produces a new object even if content is identical.
		if (first === null) {
			expect(forced).toBeNull();
		} else {
			expect(forced).not.toBe(first);
		}
	}, 15_000);
});
