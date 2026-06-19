import type { ChatEvent } from "@toby/core/chat-pipeline/chat-events";
import {
	deserializeTranscriptRow,
	serializeTranscriptEntry,
} from "@toby/core/transcript-persist";
import { describe, expect, it } from "vitest";
import {
	applyChatEvent,
	formatToolCallHeader,
} from "../src/ui/chat/chat-event-reducer";
import { flattenTranscript } from "../src/ui/chat/transcript-layout";
import type { TranscriptEntry } from "../src/ui/chat/types";
import { WORKING_PLACEHOLDER_SENTINEL } from "../src/ui/chat/working-placeholder";

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

	it("propagates durationMs from tool_call_complete to the boxed_step", () => {
		let t: TranscriptEntry[] = [];
		t = applyChatEvent(t, {
			type: "tool_call_start",
			blockKey: "a",
			seq: 1,
			toolName: "listLabels",
			args: {},
		} satisfies ChatEvent);
		t = applyChatEvent(t, {
			type: "tool_call_complete",
			blockKey: "a",
			seq: 2,
			toolName: "listLabels",
			args: {},
			result: { labels: [] },
			durationMs: 1234,
		} satisfies ChatEvent);
		const row = t.find((e) => e.kind === "boxed_step" && e.id === "a");
		expect(row?.kind === "boxed_step" && row.durationMs).toBe(1234);
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

	it("prefixes the integration label when provided", () => {
		const h = formatToolCallHeader("listLabels", {}, "Gmail");
		expect(h).toBe("Gmail: List Gmail labels");
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
			integrationLabel: "Gmail",
			cacheHit: true,
		};
		const row = serializeTranscriptEntry(e);
		expect(deserializeTranscriptRow(row)).toEqual(e);
	});

	it("round-trips tool boxed_step with durationMs", () => {
		const e: TranscriptEntry = {
			kind: "boxed_step",
			id: "bk",
			seq: 1,
			variant: "tool",
			header: "List labels",
			body: "Found 1 label(s).",
			toolBlockKey: "bk",
			toolName: "listLabels",
			durationMs: 1234,
		};
		const row = serializeTranscriptEntry(e);
		expect(deserializeTranscriptRow(row)).toEqual(e);
	});

	it("round-trips lifecycle boxed_step", () => {
		const e: TranscriptEntry = {
			kind: "boxed_step",
			id: "lc1",
			seq: 2,
			variant: "lifecycle",
			header: "Saving session…",
			body: "Session data queued to save.",
		};
		const row = serializeTranscriptEntry(e);
		expect(row.kind).toBe("boxed_step");
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

	it("round-trips notice with tone", () => {
		const e: TranscriptEntry = {
			kind: "notice",
			text: "Daemon started (PID 12345).",
			tone: "success",
		};
		const row = serializeTranscriptEntry(e);
		expect(row.kind).toBe("notice");
		expect(deserializeTranscriptRow(row)).toEqual(e);
	});

	it("round-trips notice without tone", () => {
		const e: TranscriptEntry = {
			kind: "notice",
			text: "Starting daemon…",
		};
		const row = serializeTranscriptEntry(e);
		expect(deserializeTranscriptRow(row)).toEqual(e);
	});
});

describe("flattenTranscript boxed_step", () => {
	it("shows animated Working placeholder while tool body is pending", () => {
		const entries: TranscriptEntry[] = [
			{
				kind: "boxed_step",
				id: "t1",
				seq: 1,
				variant: "tool",
				header: "Gmail: Fetch inbox overview",
				body: "",
				toolBlockKey: "t1",
				toolName: "getInboxUnreadOverview",
			},
		];
		const rows = flattenTranscript(entries, "", "", true, 80, "Toby", false);
		const bb = rows.find((r) => r.kind === "boxed_block");
		expect(bb?.kind === "boxed_block" && bb.bodyLines).toEqual([
			WORKING_PLACEHOLDER_SENTINEL,
		]);
	});

	it("does not show Working placeholder when not loading", () => {
		const entries: TranscriptEntry[] = [
			{
				kind: "boxed_step",
				id: "t1",
				seq: 1,
				variant: "tool",
				header: "Gmail: Fetch inbox overview",
				body: "",
				toolBlockKey: "t1",
				toolName: "getInboxUnreadOverview",
			},
		];
		const rows = flattenTranscript(entries, "", "", false, 80);
		const bb = rows.find((r) => r.kind === "boxed_block");
		expect(bb?.kind === "boxed_block" && bb.bodyLines).toEqual([""]);
	});

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
		const rows = flattenTranscript(entries, "", "", false, 80);
		expect(rows.some((r) => r.kind === "boxed_block")).toBe(true);
		const bb = rows.find((r) => r.kind === "boxed_block");
		expect(bb && bb.kind === "boxed_block" && bb.header).toBe("List labels");
		expect(bb && bb.kind === "boxed_block" && bb.leadingGlyph).toBe("›");
		expect(bb && bb.kind === "boxed_block" && bb.cacheHit).toBe(true);
	});

	it("hides prep boxed_step when debug is off", () => {
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
		const rows = flattenTranscript(entries, "", "", false, 80, "Toby", false);
		const boxed = rows.filter((r) => r.kind === "boxed_block");
		expect(boxed).toHaveLength(1);
		expect(boxed[0]?.kind === "boxed_block" && boxed[0].variant).toBe("tool");
	});

	it("shows prep boxed_step when debug is on", () => {
		const entries: TranscriptEntry[] = [
			{
				kind: "boxed_step",
				id: "p1",
				seq: 1,
				variant: "prep",
				header: "Prompt preparation",
				body: "Ready.",
			},
		];
		const rows = flattenTranscript(entries, "", "", false, 80, "Toby", true);
		const boxed = rows.filter((r) => r.kind === "boxed_block");
		expect(boxed).toHaveLength(1);
		expect(boxed[0]?.kind === "boxed_block" && boxed[0].variant).toBe("prep");
	});

	it("hides meta entries when debug is off", () => {
		const entries: TranscriptEntry[] = [
			{ kind: "meta", text: "Configuration updated." },
		];
		const rows = flattenTranscript(entries, "", "", false, 80, "Toby", false);
		expect(rows.filter((r) => r.kind === "boxed_block")).toHaveLength(0);
	});

	it("renders meta entries as boxed notes when debug is on", () => {
		const entries: TranscriptEntry[] = [
			{ kind: "meta", text: "Configuration updated." },
		];
		const rows = flattenTranscript(entries, "", "", false, 80, "Toby", true);
		const boxed = rows.filter((r) => r.kind === "boxed_block");
		expect(boxed).toHaveLength(1);
		const note = boxed[0];
		expect(note?.kind === "boxed_block" && note.variant).toBe("meta");
		expect(note?.kind === "boxed_block" && note.header).toBe("Session note");
		expect(note?.kind === "boxed_block" && note.bodyLines).toEqual([
			"Configuration updated.",
		]);
	});

	it("groups consecutive meta entries when debug is on", () => {
		const entries: TranscriptEntry[] = [
			{ kind: "meta", text: "Starting daemon…" },
			{ kind: "meta", text: "Daemon started (PID 12345)." },
			{ kind: "assistant", text: "Done." },
		];
		const rows = flattenTranscript(entries, "", "", false, 80, "Toby", true);
		const boxed = rows.filter((r) => r.kind === "boxed_block");
		expect(boxed).toHaveLength(1);
		const metaBox = boxed[0];
		expect(metaBox?.kind === "boxed_block" && metaBox.variant).toBe("meta");
		expect(metaBox?.kind === "boxed_block" && metaBox.bodyLines).toEqual([
			"Starting daemon…",
			"Daemon started (PID 12345).",
		]);
		expect(rows.some((r) => r.kind === "assistant_line")).toBe(true);
	});

	it("shows notice entries when debug is off", () => {
		const entries: TranscriptEntry[] = [
			{ kind: "notice", text: "Daemon started (PID 12345).", tone: "success" },
		];
		const rows = flattenTranscript(entries, "", "", false, 80, "Toby", false);
		expect(rows.filter((r) => r.kind === "notice")).toEqual([
			{
				kind: "notice",
				text: "Daemon started (PID 12345).",
				tone: "success",
			},
		]);
	});

	it("groups consecutive notice entries without debug", () => {
		const entries: TranscriptEntry[] = [
			{ kind: "notice", text: "Starting daemon…", tone: "info" },
			{ kind: "notice", text: "Daemon started (PID 12345).", tone: "success" },
			{ kind: "assistant", text: "Done." },
		];
		const rows = flattenTranscript(entries, "", "", false, 80, "Toby", false);
		const notices = rows.filter((r) => r.kind === "notice");
		expect(notices).toHaveLength(2);
		expect(notices[0]).toEqual({
			kind: "notice",
			text: "Starting daemon…",
			tone: "info",
		});
		expect(notices[1]).toEqual({
			kind: "notice",
			text: "Daemon started (PID 12345).",
			tone: "success",
		});
		expect(rows.some((r) => r.kind === "assistant_line")).toBe(true);
	});

	it("hides meta but shows notice in the same transcript", () => {
		const entries: TranscriptEntry[] = [
			{ kind: "meta", text: "Tools in scope: Gmail (1)" },
			{ kind: "notice", text: "Daemon started (PID 12345).", tone: "success" },
		];
		const rows = flattenTranscript(entries, "", "", false, 80, "Toby", false);
		expect(rows.some((r) => r.kind === "notice")).toBe(true);
		expect(rows.some((r) => r.kind === "boxed_block")).toBe(false);
	});

	it("lifecycle_start then lifecycle_end updates the same boxed row", () => {
		const id = "lc-1";
		let t: TranscriptEntry[] = [];
		t = applyChatEvent(t, {
			type: "lifecycle_start",
			id,
			seq: 1,
			header: "Preparing Session…",
		} satisfies ChatEvent);
		expect(t).toHaveLength(1);
		expect(t[0]?.kind).toBe("boxed_step");
		if (t[0]?.kind === "boxed_step") {
			expect(t[0].variant).toBe("lifecycle");
		}
		t = applyChatEvent(t, {
			type: "lifecycle_end",
			id,
			seq: 2,
			detail: "Session Ready.",
		} satisfies ChatEvent);
		expect(t).toHaveLength(1);
		const row = t[0];
		expect(row?.kind).toBe("boxed_step");
		if (row?.kind === "boxed_step") {
			expect(row.body).toBe("Session Ready.");
		}
	});

	it("lifecycle_set replaces the lifecycle body with one line", () => {
		const id = "lc-set";
		let t: TranscriptEntry[] = [];
		t = applyChatEvent(t, {
			type: "lifecycle_start",
			id,
			seq: 1,
			header: "Preparing Session…",
		} satisfies ChatEvent);
		t = applyChatEvent(t, {
			type: "lifecycle_set",
			id,
			seq: 2,
			line: "Loading Gmail connection context…",
		} satisfies ChatEvent);
		t = applyChatEvent(t, {
			type: "lifecycle_set",
			id,
			seq: 3,
			line: "Session ready.",
		} satisfies ChatEvent);
		const row = t[0];
		expect(row?.kind).toBe("boxed_step");
		if (row?.kind === "boxed_step") {
			expect(row.body).toBe("Session ready.");
		}
	});

	it("lifecycle_append accumulates detail lines on the same row", () => {
		const id = "lc-2";
		let t: TranscriptEntry[] = [];
		t = applyChatEvent(t, {
			type: "lifecycle_start",
			id,
			seq: 1,
			header: "Preparing Session…",
		} satisfies ChatEvent);
		t = applyChatEvent(t, {
			type: "lifecycle_append",
			id,
			seq: 2,
			line: "Scope: Gmail",
		} satisfies ChatEvent);
		t = applyChatEvent(t, {
			type: "lifecycle_append",
			id,
			seq: 3,
			line: "Loading Gmail connection context…",
		} satisfies ChatEvent);
		t = applyChatEvent(t, {
			type: "lifecycle_end",
			id,
			seq: 4,
			detail: "Session ready.",
		} satisfies ChatEvent);
		const row = t[0];
		expect(row?.kind).toBe("boxed_step");
		if (row?.kind === "boxed_step") {
			expect(row.body).toBe(
				"Scope: Gmail\nLoading Gmail connection context…\nSession ready.",
			);
		}
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
		const rows = flattenTranscript(entries, "", "", false, 80);
		const bb = rows.find((r) => r.kind === "boxed_block");
		expect(bb?.kind).toBe("boxed_block");
		if (bb?.kind === "boxed_block") {
			expect(bb.header).toBe("List labels (x2)");
			expect(bb.bodyLines).toHaveLength(2);
			expect(bb.bodyLines[0]).toBe("2. List labels [cache]");
			expect(bb.bodyLines.join("\n")).toContain("2. List labels [cache]");
		}
	});

	it("collapses repeated identical grouped tool runs into one body", () => {
		const entries: TranscriptEntry[] = [
			{
				kind: "boxed_step",
				id: "group-1",
				seq: 1,
				variant: "tool",
				header: "Fetch email metadata (x3)",
				body: "",
				toolName: "fetchEmailMetadata",
				toolRuns: [
					{
						blockKey: "a",
						header: "Fetch email metadata",
						body: "Found 20 email(s).",
					},
					{
						blockKey: "b",
						header: "Fetch email metadata",
						body: "Found 20 email(s).",
					},
					{
						blockKey: "c",
						header: "Fetch email metadata",
						body: "Found 20 email(s).",
					},
				],
			},
		];
		const rows = flattenTranscript(entries, "", "", false, 80);
		const bb = rows.find((r) => r.kind === "boxed_block");
		expect(bb?.kind).toBe("boxed_block");
		if (bb?.kind === "boxed_block") {
			expect(bb.header).toBe("Fetch email metadata (x3)");
			expect(bb.bodyLines).toEqual(["Found 20 email(s)."]);
		}
	});

	it("caps non-assistant body lines to the last three lines", () => {
		const entries: TranscriptEntry[] = [
			{
				kind: "boxed_step",
				id: "t1",
				seq: 1,
				variant: "tool",
				header: "List labels",
				body: "one\ntwo\nthree\nfour",
				toolName: "listLabels",
			},
		];
		const rows = flattenTranscript(entries, "", "", false, 80);
		const bb = rows.find((r) => r.kind === "boxed_block");
		expect(bb?.kind).toBe("boxed_block");
		if (bb?.kind === "boxed_block") {
			expect(bb.bodyLines).toEqual(["two", "three", "four"]);
		}
	});
});

describe("plan events", () => {
	it("plan_created adds a plan boxed step", () => {
		let t: TranscriptEntry[] = [];
		t = applyChatEvent(t, {
			type: "plan_created",
			id: "plan-1",
			seq: 1,
			goal: "Organize inbox",
			phaseCount: 3,
		} satisfies ChatEvent);
		expect(t).toHaveLength(1);
		const row = t[0];
		expect(row?.kind).toBe("boxed_step");
		if (row?.kind === "boxed_step") {
			expect(row.variant).toBe("plan");
			expect(row.header).toBe("Plan: Organize inbox");
			expect(row.body).toContain("1. (pending)");
			expect(row.body).toContain("3. (pending)");
		}
	});

	it("plan_phase_start then plan_phase_end updates the lifecycle row", () => {
		let t: TranscriptEntry[] = [];
		t = applyChatEvent(t, {
			type: "plan_phase_start",
			planId: "plan-1",
			phaseId: "phase-1",
			seq: 1,
			label: "Fetch emails",
			index: 0,
			total: 3,
		} satisfies ChatEvent);
		expect(t).toHaveLength(1);
		expect(t[0]?.kind).toBe("boxed_step");
		if (t[0]?.kind === "boxed_step") {
			expect(t[0].header).toBe("Phase 1/3: Fetch emails");
		}
		t = applyChatEvent(t, {
			type: "plan_phase_end",
			planId: "plan-1",
			phaseId: "phase-1",
			seq: 2,
			status: "completed",
		} satisfies ChatEvent);
		expect(t).toHaveLength(1);
		const row = t[0];
		expect(row?.kind).toBe("boxed_step");
		if (row?.kind === "boxed_step") {
			expect(row.body).toBe("Completed");
		}
	});

	it("plan_amended does not add transcript rows", () => {
		let t: TranscriptEntry[] = [];
		t = applyChatEvent(t, {
			type: "plan_amended",
			planId: "plan-1",
			seq: 1,
			detail: 'Added phase "Review" after phase 2',
		} satisfies ChatEvent);
		expect(t).toHaveLength(0);
	});

	it("plan_completed does not add transcript rows", () => {
		let t: TranscriptEntry[] = [];
		t = applyChatEvent(t, {
			type: "plan_completed",
			planId: "plan-1",
			seq: 1,
			status: "completed",
		} satisfies ChatEvent);
		expect(t).toHaveLength(0);
	});

	it("transcript_notice adds a persisted notice row", () => {
		let t: TranscriptEntry[] = [];
		t = applyChatEvent(t, {
			type: "transcript_notice",
			seq: 1,
			text: "Skills: inbox-triage",
			tone: "info",
		} satisfies ChatEvent);
		expect(t).toEqual([
			{ kind: "notice", text: "Skills: inbox-triage", tone: "info" },
		]);
	});

	it("round-trips plan boxed_step", () => {
		const e: TranscriptEntry = {
			kind: "boxed_step",
			id: "plan-1",
			seq: 1,
			variant: "plan",
			header: "Plan: Organize inbox",
			body: "Phases:\n  1. (pending)",
		};
		const row = serializeTranscriptEntry(e);
		expect(row.kind).toBe("boxed_step");
		expect(deserializeTranscriptRow(row)).toEqual(e);
	});
});

describe("flattenTranscript hidden lifecycle headers", () => {
	const hiddenEntries: TranscriptEntry[] = [
		{
			kind: "boxed_step",
			id: "l1",
			seq: 1,
			variant: "lifecycle",
			header: "Chatting with Default",
			body: "",
		},
		{
			kind: "boxed_step",
			id: "l2",
			seq: 2,
			variant: "lifecycle",
			header: "Updating session messages…",
			body: "Session messages updated.",
		},
		{
			kind: "boxed_step",
			id: "l3",
			seq: 3,
			variant: "lifecycle",
			header: "Saving session…",
			body: "Session data queued to save.",
		},
	];

	it("hides specific lifecycle headers when debug is off", () => {
		const rows = flattenTranscript(
			hiddenEntries,
			"",
			"",
			false,
			80,
			"Toby",
			false,
		);
		const boxed = rows.filter((r) => r.kind === "boxed_block");
		expect(boxed).toHaveLength(0);
	});

	it("shows specific lifecycle headers when debug is on", () => {
		const rows = flattenTranscript(
			hiddenEntries,
			"",
			"",
			false,
			80,
			"Toby",
			true,
		);
		const boxed = rows.filter((r) => r.kind === "boxed_block");
		expect(boxed).toHaveLength(3);
	});

	it("does not hide other lifecycle headers", () => {
		const entries: TranscriptEntry[] = [
			{
				kind: "boxed_step",
				id: "p1",
				seq: 1,
				variant: "lifecycle",
				header: "Phase 1/2: Process inbox",
				body: "Completed",
			},
		];
		const rows = flattenTranscript(entries, "", "", false, 80, "Toby", false);
		const boxed = rows.filter((r) => r.kind === "boxed_block");
		expect(boxed).toHaveLength(1);
	});

	it("hides Preparing Session lifecycle when debug is off", () => {
		const entries: TranscriptEntry[] = [
			{
				kind: "boxed_step",
				id: "boot",
				seq: 1,
				variant: "lifecycle",
				header: "Preparing Session…",
				body: "Fetching integration connection context…",
			},
		];
		const rows = flattenTranscript(entries, "", "", false, 80, "Toby", false);
		expect(rows.filter((r) => r.kind === "boxed_block")).toHaveLength(0);
	});
});
