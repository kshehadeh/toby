import {
	escapeForAppleScript,
	parseAppleScriptDate,
} from "@toby/core/integrations/shared/applescript";
import { describe, expect, it } from "vitest";

describe("escapeForAppleScript", () => {
	it("escapes backslashes and double quotes", () => {
		expect(escapeForAppleScript(`say "hi" \\ path`)).toBe(
			`say \\"hi\\" \\\\ path`,
		);
	});

	it("returns empty for empty input", () => {
		expect(escapeForAppleScript("")).toBe("");
	});
});

describe("parseAppleScriptDate", () => {
	it("parses YYYY-M-D-H-m-s from AppleScript snippet output", () => {
		const d = parseAppleScriptDate("2026-5-2-14-30-0");
		expect(d.getFullYear()).toBe(2026);
		expect(d.getMonth()).toBe(4);
		expect(d.getDate()).toBe(2);
	});
});
