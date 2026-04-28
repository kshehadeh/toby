import { describe, expect, it } from "vitest";
import {
	formatToolFeedbackOutput,
	registerToolFeedbackFormatter,
} from "../src/ui/chat/tool-feedback-registry";
import { flattenTranscript } from "../src/ui/chat/transcript-layout";
import {
	deserializeTranscriptRow,
	serializeTranscriptEntry,
} from "../src/ui/chat/transcript-persist";
import type { TranscriptEntry } from "../src/ui/chat/types";

describe("tool feedback registry", () => {
	it("uses default formatter for unknown tools with task arrays", () => {
		expect(
			formatToolFeedbackOutput({
				toolName: "someUnknownTool",
				args: {},
				result: { tasks: [1, 2, 3] },
			}),
		).toBe("Found 3 item(s).");
	});

	it("summarizes inbox overview results", () => {
		expect(
			formatToolFeedbackOutput({
				toolName: "getInboxUnreadOverview",
				args: {},
				result: {
					messageSummaries: [{ id: "a" }, { id: "b" }],
					resultSizeEstimate: 42,
					hasMorePages: true,
				},
			}),
		).toBe("Inbox: 2 on this page, ~42 match(es). More pages available.");
	});

	it("summarizes label list results", () => {
		expect(
			formatToolFeedbackOutput({
				toolName: "listLabels",
				args: {},
				result: { labels: [{ name: "x", id: "1" }] },
			}),
		).toBe("Found 1 label(s).");
	});

	it("formats tool errors", () => {
		expect(
			formatToolFeedbackOutput({
				toolName: "x",
				args: {},
				result: undefined,
				error: new Error("boom"),
			}),
		).toBe("Failed: boom");
	});

	it("uses registered formatter when present", () => {
		registerToolFeedbackFormatter("customTool", () => "Custom line");
		expect(
			formatToolFeedbackOutput({
				toolName: "customTool",
				args: {},
				result: {},
			}),
		).toBe("Custom line");
	});

	it("falls back when custom formatter throws", () => {
		registerToolFeedbackFormatter("throwsTool", () => {
			throw new Error("nope");
		});
		expect(
			formatToolFeedbackOutput({
				toolName: "throwsTool",
				args: {},
				result: { tasks: [1] },
			}),
		).toBe("Found 1 item(s).");
	});

	it("falls back when custom formatter returns empty", () => {
		registerToolFeedbackFormatter("emptyTool", () => "   ");
		expect(
			formatToolFeedbackOutput({
				toolName: "emptyTool",
				args: {},
				result: { message: "hello" },
			}),
		).toBe("hello");
	});
});

describe("transcript persistence for tool rows", () => {
	it("round-trips tool_call and tool_output", () => {
		const call: TranscriptEntry = {
			kind: "tool_call",
			blockKey: "bk-1",
			title: "Fetch tasks",
		};
		const out: TranscriptEntry = {
			kind: "tool_output",
			blockKey: "bk-1",
			detail: "Found 2 item(s).",
		};
		const callRow = serializeTranscriptEntry(call);
		const outRow = serializeTranscriptEntry(out);
		expect(callRow.kind).toBe("tool_call");
		expect(outRow.kind).toBe("tool_output");
		expect(deserializeTranscriptRow(callRow)).toEqual(call);
		expect(deserializeTranscriptRow(outRow)).toEqual(out);
	});

	it("maps corrupt tool JSON to meta", () => {
		expect(
			deserializeTranscriptRow({ kind: "tool_call", text: "not-json" }),
		).toEqual({ kind: "meta", text: "not-json" });
	});

	it("round-trips ask_user_qa", () => {
		const entry: TranscriptEntry = {
			kind: "ask_user_qa",
			blockKey: "a1",
			query: "Which project?",
			answer: "Work",
		};
		const row = serializeTranscriptEntry(entry);
		expect(row.kind).toBe("ask_user_qa");
		expect(deserializeTranscriptRow(row)).toEqual(entry);
	});
});

describe("flattenTranscript tool feedback", () => {
	it("emits tool feedback rows for tool_call and tool_output", () => {
		const entries: TranscriptEntry[] = [
			{
				kind: "tool_call",
				blockKey: "x",
				title: "Update task",
			},
			{
				kind: "tool_output",
				blockKey: "x",
				detail: "Updated task.",
			},
		];
		const rows = flattenTranscript(entries, "", false, 80);
		const kinds = rows.map((r) => r.kind);
		expect(kinds).toContain("tool_feedback_call");
		expect(kinds).toContain("tool_feedback_output");
		const call = rows.find((r) => r.kind === "tool_feedback_call");
		expect(call && call.kind === "tool_feedback_call" && call.title).toBe(
			"Update task",
		);
	});

	it("emits ask_user_qa display rows", () => {
		const entries: TranscriptEntry[] = [
			{
				kind: "ask_user_qa",
				blockKey: "q1",
				query: "Delete this task?",
				answer: "Yes, delete it",
			},
		];
		const rows = flattenTranscript(entries, "", false, 80);
		expect(rows.some((r) => r.kind === "ask_user_qa")).toBe(true);
		const row = rows.find((r) => r.kind === "ask_user_qa");
		expect(row && row.kind === "ask_user_qa" && row.query).toBe(
			"Delete this task?",
		);
	});
});
