import { describe, expect, it } from "bun:test";
import { STANDARD_TOOL_FOR_CATEGORY } from "@toby/core/dashboard/types";
import { TOOL_DEFINITIONS } from "../../plugin-applecalendar/src/tools";

describe("Apple Calendar plugin", () => {
	it("tags getUpcomingEventsSummary with calendar.upcomingSummary standardTool", () => {
		const summaryTool = TOOL_DEFINITIONS.find(
			(t) => t.name === "getUpcomingEventsSummary",
		);
		expect(summaryTool).toBeDefined();
		expect(summaryTool?.standardTool).toBe("calendar.upcomingSummary");
		expect(summaryTool?.readOnly).toBe(true);
		expect(STANDARD_TOOL_FOR_CATEGORY.calendar).toBe(
			"calendar.upcomingSummary",
		);
	});

	it("includes core calendar tools", () => {
		const names = TOOL_DEFINITIONS.map((t) => t.name);
		expect(names).toContain("listCalendars");
		expect(names).toContain("searchCalendarEvents");
		expect(names).toContain("getUpcomingEventsSummary");
		expect(names).toContain("getCalendarEvent");
	});
});
