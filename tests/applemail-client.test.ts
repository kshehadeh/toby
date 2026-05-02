import { describe, expect, it } from "vitest";
import {
	escapeForAppleScript,
	parseAppleMailAccountListOutput,
	parseAppleScriptDate,
	parseMailboxListOutput,
} from "../src/integrations/applemail/client";

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

describe("parseAppleMailAccountListOutput", () => {
	it("parses name and optional email segments", () => {
		const raw = "Work<<<EM>>>a@b.com<<<ACCITEM>>>Personal<<<EM>>>";
		const rows = parseAppleMailAccountListOutput(raw);
		expect(rows).toEqual([
			{ name: "Work", email: "a@b.com" },
			{ name: "Personal" },
		]);
	});
});

describe("parseMailboxListOutput", () => {
	it("parses account and mailbox name rows", () => {
		const raw =
			"Work<<<MBCOL>>>INBOX<<<MBROW>>>Work<<<MBCOL>>>Sent Messages<<<MBROW>>>Personal<<<MBCOL>>>Notes";
		const rows = parseMailboxListOutput(raw);
		expect(rows).toEqual([
			{ account: "Work", name: "INBOX" },
			{ account: "Work", name: "Sent Messages" },
			{ account: "Personal", name: "Notes" },
		]);
	});
});
