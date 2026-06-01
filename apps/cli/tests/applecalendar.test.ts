import { describe, expect, it } from "vitest";
import {
	normalizeToAppleScriptDate,
	parseCalendarListOutput,
	parseEventListOutput,
} from "../src/integrations/applecalendar/client";
import {
	getIntegrationModule,
	getIntegrationModules,
	getModulesForCategory,
} from "../src/integrations/index";

describe("Apple Calendar integration registration", () => {
	it("is registered in the module list", () => {
		const names = getIntegrationModules().map((m) => m.name);
		expect(names).toContain("applecalendar");
	});

	it("module has correct identity fields", () => {
		const mod = getIntegrationModule("applecalendar");
		expect(mod).toBeDefined();
		expect(mod?.displayName).toBe("Apple Calendar");
		expect(mod?.description.length).toBeGreaterThan(0);
	});

	it("declares chat capability", () => {
		const mod = getIntegrationModule("applecalendar");
		expect(mod?.capabilities).toContain("chat");
	});

	it("declares calendar provider category", () => {
		const calendarMods = getModulesForCategory("calendar");
		expect(calendarMods.some((m) => m.name === "applecalendar")).toBe(true);
	});

	it("exposes credential descriptors", () => {
		const mod = getIntegrationModule("applecalendar");
		const descriptors = mod?.getCredentialDescriptors();
		expect(descriptors.length).toBeGreaterThan(0);
		for (const d of descriptors) {
			expect(d.key).toMatch(/^applecalendar\./);
		}
	});

	it("chat-capable module defines chat()", () => {
		const mod = getIntegrationModule("applecalendar");
		expect(typeof mod?.chat).toBe("function");
	});

	it("has chatModelPrep", () => {
		const mod = getIntegrationModule("applecalendar");
		expect(mod?.chatModelPrep).toBeDefined();
		expect(typeof mod?.chatModelPrep?.buildSingleSessionMessages).toBe(
			"function",
		);
		expect(typeof mod?.chatModelPrep?.buildMultiUserContent).toBe("function");
	});

	it("has createChatTools", () => {
		const mod = getIntegrationModule("applecalendar");
		expect(typeof mod?.createChatTools).toBe("function");
	});

	it("has chatReadiness", () => {
		const mod = getIntegrationModule("applecalendar");
		expect(typeof mod?.chatReadiness).toBe("function");
	});
});

describe("parseCalendarListOutput", () => {
	it("parses empty string", () => {
		expect(parseCalendarListOutput("")).toEqual([]);
	});

	it("parses single calendar", () => {
		const raw = "Home|||CALCOL|||Red";
		const result = parseCalendarListOutput(raw);
		expect(result).toEqual([{ name: "Home", color: "Red" }]);
	});

	it("parses multiple calendars", () => {
		const raw = "Home|||CALCOL|||Red|||CALROW|||Work|||CALCOL|||Blue";
		const result = parseCalendarListOutput(raw);
		expect(result).toEqual([
			{ name: "Home", color: "Red" },
			{ name: "Work", color: "Blue" },
		]);
	});
});

describe("parseEventListOutput", () => {
	it("parses empty string", () => {
		expect(parseEventListOutput("", "Home")).toEqual([]);
	});

	it("parses single event", () => {
		const raw =
			"abc-123|||EVTCOL|||Team Standup|||EVTCOL|||2026-5-12-9-0-0|||EVTCOL|||2026-5-12-9-30-0|||EVTCOL|||false|||EVTCOL|||Conf Room A|||EVTCOL|||Daily standup";
		const result = parseEventListOutput(raw, "Work");
		expect(result.length).toBe(1);
		expect(result[0]?.uid).toBe("abc-123");
		expect(result[0]?.summary).toBe("Team Standup");
		expect(result[0]?.isAllDay).toBe(false);
		expect(result[0]?.location).toBe("Conf Room A");
		expect(result[0]?.calendar).toBe("Work");
		expect(result[0]?.startDate.getFullYear()).toBe(2026);
	});

	it("parses multiple events", () => {
		const raw =
			"uid1|||EVTCOL|||Event 1|||EVTCOL|||2026-5-12-9-0-0|||EVTCOL|||2026-5-12-10-0-0|||EVTCOL|||false|||EVTCOL|||Loc A|||EVTCOL|||Desc 1|||EVTROW|||uid2|||EVTCOL|||Event 2|||EVTCOL|||2026-5-13-14-0-0|||EVTCOL|||2026-5-13-15-0-0|||EVTCOL|||true|||EVTCOL|||Loc B|||EVTCOL|||Desc 2";
		const result = parseEventListOutput(raw, "Home");
		expect(result.length).toBe(2);
		expect(result[0]?.uid).toBe("uid1");
		expect(result[0]?.isAllDay).toBe(false);
		expect(result[1]?.uid).toBe("uid2");
		expect(result[1]?.isAllDay).toBe(true);
	});

	it("skips malformed blocks with fewer than 7 fields", () => {
		const raw = "uid1|||EVTCOL|||Only 3 fields|||EVTCOL|||extra";
		const result = parseEventListOutput(raw, "Home");
		expect(result).toEqual([]);
	});
});

describe("normalizeToAppleScriptDate", () => {
	it("passes through natural language dates", () => {
		expect(normalizeToAppleScriptDate("May 12, 2026")).toBe("May 12, 2026");
		expect(normalizeToAppleScriptDate("January 1, 2026")).toBe(
			"January 1, 2026",
		);
	});

	it("converts ISO 8601 date-only to AppleScript format", () => {
		expect(normalizeToAppleScriptDate("2026-05-12")).toBe("May 12, 2026");
		expect(normalizeToAppleScriptDate("2026-01-01")).toBe("January 1, 2026");
	});

	it("converts ISO 8601 datetime to AppleScript format", () => {
		const result = normalizeToAppleScriptDate("2026-05-12T09:00:00");
		expect(result).toContain("May 12, 2026");
		expect(result).toContain("9:00:00 AM");
	});

	it("converts ISO 8601 datetime with PM hours", () => {
		const result = normalizeToAppleScriptDate("2026-05-12T14:30:00");
		expect(result).toContain("May 12, 2026");
		expect(result).toContain("2:30:00 PM");
	});

	it("returns unrecognizable input as-is", () => {
		expect(normalizeToAppleScriptDate("some random text")).toBe(
			"some random text",
		);
	});

	it("handles slash-formatted dates", () => {
		const result = normalizeToAppleScriptDate("05/12/2026");
		expect(result).toBe("May 12, 2026");
	});
});
