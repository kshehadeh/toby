import { describe, expect, it } from "bun:test";
import { STANDARD_TOOL_FOR_CATEGORY } from "@toby/core/dashboard/types";
import {
	TOOL_DEFINITIONS,
	meetingNotes,
} from "../../plugin-applecalendar/src/tools";

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

describe("meetingNotes", () => {
	it("drops video-call join boilerplate and keeps real agendas", () => {
		expect(
			meetingNotes(
				"________________________________________________________________________________\nMicrosoft Teams Need help?\nJoin the meeting now\nMeeting ID: 123 456\nPasscode: abc\n________________________________________________________________________________",
			),
		).toBeUndefined();
		expect(
			meetingNotes(
				"https://acme.zoom.us/j/123?pwd=x\nMeeting ID: 123\nOne tap mobile\n+16469313860,,123#",
			),
		).toBeUndefined();
		expect(
			meetingNotes(
				"Agenda:\n- Q3 numbers\nJoin Zoom Meeting\nhttps://x.zoom.us/j/1",
			),
		).toBe("Agenda:\n- Q3 numbers");
	});
});
