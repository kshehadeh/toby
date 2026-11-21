import { describe, expect, it } from "bun:test";
import { reminderDeepLink } from "../../plugin-applereminders/src/tools";

describe("reminderDeepLink", () => {
	it("links to the reminder in Reminders.app", () => {
		expect(reminderDeepLink("9016D9D3-C44D-42BF-A918-6F9B6E1F3AF5")).toBe(
			"x-apple-reminderkit://REMCDReminder/9016D9D3-C44D-42BF-A918-6F9B6E1F3AF5",
		);
	});

	it("is undefined without an id", () => {
		expect(reminderDeepLink("  ")).toBeUndefined();
	});
});
