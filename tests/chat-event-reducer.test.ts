import { describe, expect, it } from "vitest";
import type { ChatEvent } from "../src/chat-pipeline/chat-events";
import {
	applyChatEvent,
	formatToolCallHeader,
} from "../src/ui/chat/chat-event-reducer";
import { flattenTranscript } from "../src/ui/chat/transcript-layout";
import {
	deserializeTranscriptRow,
	serializeTranscriptEntry,
} from "../src/ui/chat/transcript-persist";
import type { TranscriptEntry } from "../src/ui/chat/types";

describe("applyChatEvent", () => {
	it("prep_start then prep_end updates the same boxed row", () => {
		const id = "prep-1";
		let t: TranscriptEntry[] = [];
		t = applyChatEvent(t, {
			type: "prep_start",
			id,
			seq: 1,
			header: "Prompt preparation",
		} satisfies ChatEvent);
		expect(t).toHaveLength(1);
		expect(t[0]?.kind).toBe("boxed_step");
		t = applyChatEvent(t, {
			type: "prep_end",
			id,
			seq: 2,
			detail: "Request prepared.",
		} satisfies ChatEvent);
		expect(t).toHaveLength(1);
		const row = t[0];
		expect(row?.kind).toBe("boxed_step");
		if (row?.kind === "boxed_step") {
			expect(row.body).toBe("Request prepared.");
		}
	});

	it("orders concurrent tools by append sequence and updates the matching tool body", () => {
		let t: TranscriptEntry[] = [];
		t = applyChatEvent(t, {
			type: "tool_call_start",
			blockKey: "a",
			seq: 1,
			toolName: "fetchOpenTasks",
			args: {},
		} satisfies ChatEvent);
		t = applyChatEvent(t, {
			type: "tool_call_start",
			blockKey: "b",
			seq: 2,
			toolName: "listLabels",
			args: {},
		} satisfies ChatEvent);
		t = applyChatEvent(t, {
			type: "tool_call_complete",
			blockKey: "b",
			seq: 3,
			toolName: "listLabels",
			args: {},
			result: { labels: [{ name: "x", id: "1" }] },
			cacheHit: true,
		} satisfies ChatEvent);
		t = applyChatEvent(t, {
			type: "tool_call_complete",
			blockKey: "a",
			seq: 4,
			toolName: "fetchOpenTasks",
			args: {},
			result: { tasks: [1] },
		} satisfies ChatEvent);
		expect(t.filter((e) => e.kind === "boxed_step")).toHaveLength(2);
		const a = t.find((e) => e.kind === "boxed_step" && e.id === "a");
		const b = t.find((e) => e.kind === "boxed_step" && e.id === "b");
		expect(a?.kind === "boxed_step" && a.body).toContain("task");
		expect(b?.kind === "boxed_step" && b.body).toContain("label");
		expect(b?.kind === "boxed_step" && b.cacheHit).toBe(true);
	});

	it("groups consecutive starts for the same tool into one boxed row", () => {
		let t: TranscriptEntry[] = [];
		t = applyChatEvent(t, {
			type: "tool_call_start",
			blockKey: "a",
			seq: 1,
			toolName: "listLabels",
			args: { query: "inbox" },
		} satisfies ChatEvent);
		t = applyChatEvent(t, {
			type: "tool_call_start",
			blockKey: "b",
			seq: 2,
			toolName: "listLabels",
			args: { query: "work" },
		} satisfies ChatEvent);
		const boxed = t.filter((e) => e.kind === "boxed_step");
		expect(boxed).toHaveLength(1);
		const row = boxed[0];
		expect(row?.kind).toBe("boxed_step");
		if (row?.kind === "boxed_step") {
			expect(row.header).toContain("(x2)");
			expect(row.toolRuns).toHaveLength(2);
		}
	});

	it("does not group interleaved different tools", () => {
		let t: TranscriptEntry[] = [];
		t = applyChatEvent(t, {
			type: "tool_call_start",
			blockKey: "a",
			seq: 1,
			toolName: "listLabels",
			args: {},
		} satisfies ChatEvent);
		t = applyChatEvent(t, {
			type: "tool_call_start",
			blockKey: "b",
			seq: 2,
			toolName: "fetchOpenTasks",
			args: {},
		} satisfies ChatEvent);
		t = applyChatEvent(t, {
			type: "tool_call_start",
			blockKey: "c",
			seq: 3,
			toolName: "listLabels",
			args: {},
		} satisfies ChatEvent);
		expect(t.filter((e) => e.kind === "boxed_step")).toHaveLength(3);
	});

	it("updates grouped runs correctly when completions arrive out of order", () => {
		let t: TranscriptEntry[] = [];
		t = applyChatEvent(t, {
			type: "tool_call_start",
			blockKey: "a",
			seq: 1,
			toolName: "listLabels",
			args: {},
		} satisfies ChatEvent);
		t = applyChatEvent(t, {
			type: "tool_call_start",
			blockKey: "b",
			seq: 2,
			toolName: "listLabels",
			args: {},
		} satisfies ChatEvent);
		t = applyChatEvent(t, {
			type: "tool_call_complete",
			blockKey: "b",
			seq: 3,
			toolName: "listLabels",
			args: {},
			result: { labels: [{ id: "1", name: "Work" }] },
			cacheHit: true,
		} satisfies ChatEvent);
		t = applyChatEvent(t, {
			type: "tool_call_complete",
			blockKey: "a",
			seq: 4,
			toolName: "listLabels",
			args: {},
			result: { labels: [{ id: "2", name: "Home" }] },
		} satisfies ChatEvent);
		const row = t[0];
		expect(row?.kind).toBe("boxed_step");
		if (row?.kind === "boxed_step") {
			expect(row.toolRuns).toHaveLength(2);
			const first = row.toolRuns?.find((run) => run.blockKey === "a");
			const second = row.toolRuns?.find((run) => run.blockKey === "b");
			expect(first?.body).toContain("label");
			expect(second?.body).toContain("label");
			expect(second?.cacheHit).toBe(true);
		}
	});

	it("resets grouping after non-tool entries", () => {
		let t: TranscriptEntry[] = [];
		t = applyChatEvent(t, {
			type: "tool_call_start",
			blockKey: "a",
			seq: 1,
			toolName: "listLabels",
			args: {},
		} satisfies ChatEvent);
		t = [...t, { kind: "assistant", text: "interruption" }];
		t = applyChatEvent(t, {
			type: "tool_call_start",
			blockKey: "b",
			seq: 2,
			toolName: "listLabels",
			args: {},
		} satisfies ChatEvent);
		expect(t.filter((e) => e.kind === "boxed_step")).toHaveLength(2);
	});
});

describe("formatToolCallHeader", () => {
	it("includes a short id target when present in args", () => {
		const longId = `${"x".repeat(40)}end`;
		const h = formatToolCallHeader("archiveEmailById", {
			messageId: longId,
		});
		expect(h).toContain("…");
		expect(h).toContain("Archive email");
	});
});

describe("boxed_step persistence", () => {
	it("round-trips boxed_step", () => {
		const e: TranscriptEntry = {
			kind: "boxed_step",
			id: "x1",
			seq: 3,
			variant: "assistant",
			header: "Toby",
			body: "Hello",
		};
		const row = serializeTranscriptEntry(e);
		expect(row.kind).toBe("boxed_step");
		expect(deserializeTranscriptRow(row)).toEqual(e);
	});

	it("round-trips tool boxed_step with toolName", () => {
		const e: TranscriptEntry = {
			kind: "boxed_step",
			id: "bk",
			seq: 1,
			variant: "tool",
			header: "List labels",
			body: "Found 1 label(s).",
			toolBlockKey: "bk",
			toolName: "listLabels",
			cacheHit: true,
		};
		const row = serializeTranscriptEntry(e);
		expect(deserializeTranscriptRow(row)).toEqual(e);
	});

	it("round-trips grouped tool runs", () => {
		const e: TranscriptEntry = {
			kind: "boxed_step",
			id: "group-1",
			seq: 3,
			variant: "tool",
			header: "List labels (x2)",
			body: "",
			toolBlockKey: "a",
			toolName: "listLabels",
			toolRuns: [
				{
					blockKey: "a",
					header: "List labels",
					body: "Found 1 label(s).",
				},
				{
					blockKey: "b",
					header: "List labels",
					body: "Found 2 label(s).",
					cacheHit: true,
				},
			],
		};
		const row = serializeTranscriptEntry(e);
		expect(deserializeTranscriptRow(row)).toEqual(e);
	});
});

describe("flattenTranscript boxed_step", () => {
	it("emits boxed_block rows", () => {
		const entries: TranscriptEntry[] = [
			{
				kind: "boxed_step",
				id: "t1",
				seq: 1,
				variant: "tool",
				header: "List labels",
				body: "Found 1 label(s).",
				toolBlockKey: "t1",
				toolName: "listLabels",
				cacheHit: true,
			},
		];
		const rows = flattenTranscript(entries, "", false, 80);
		expect(rows.some((r) => r.kind === "boxed_block")).toBe(true);
		const bb = rows.find((r) => r.kind === "boxed_block");
		expect(bb && bb.kind === "boxed_block" && bb.header).toBe("List labels");
		expect(bb && bb.kind === "boxed_block" && bb.leadingGlyph).toBe("↳");
		expect(bb && bb.kind === "boxed_block" && bb.cacheHit).toBe(true);
	});

	it("hides prep boxed_step from display rows", () => {
		const entries: TranscriptEntry[] = [
			{
				kind: "boxed_step",
				id: "p1",
				seq: 1,
				variant: "prep",
				header: "Prompt preparation",
				body: "Ready.",
			},
			{
				kind: "boxed_step",
				id: "t1",
				seq: 2,
				variant: "tool",
				header: "List labels",
				body: "ok",
				toolBlockKey: "t1",
				toolName: "listLabels",
			},
		];
		const rows = flattenTranscript(entries, "", false, 80);
		const boxed = rows.filter((r) => r.kind === "boxed_block");
		expect(boxed).toHaveLength(1);
		expect(boxed[0]?.kind === "boxed_block" && boxed[0].variant).toBe("tool");
	});

	it("renders grouped tool runs as expanded body lines", () => {
		const entries: TranscriptEntry[] = [
			{
				kind: "boxed_step",
				id: "group-1",
				seq: 1,
				variant: "tool",
				header: "List labels (x2)",
				body: "",
				toolName: "listLabels",
				toolRuns: [
					{
						blockKey: "a",
						header: "List labels",
						body: "Found 1 label(s).",
					},
					{
						blockKey: "b",
						header: "List labels",
						body: "Found 2 label(s).",
						cacheHit: true,
					},
				],
			},
		];
		const rows = flattenTranscript(entries, "", false, 80);
		const bb = rows.find((r) => r.kind === "boxed_block");
		expect(bb?.kind).toBe("boxed_block");
		if (bb?.kind === "boxed_block") {
			expect(bb.header).toBe("List labels (x2)");
			expect(bb.bodyLines.join("\n")).toContain("1. List labels");
			expect(bb.bodyLines.join("\n")).toContain("2. List labels [cache]");
		}
	});
});
