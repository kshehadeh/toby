import { describe, expect, it } from "bun:test";
import {
	createToolProgressAccumulator,
	reportToolProgress,
	runWithToolProgress,
} from "@toby/core/ai/tool-progress";
import type { ChatEvent } from "@toby/core/chat-pipeline/chat-events";
import {
	clearPluginToolPresentations,
	formatToolPresentationSummary,
	getToolPresentation,
	parsePluginProgress,
	parseToolPresentation,
	registerPluginToolPresentations,
	sanitizeToolArgsForDisplay,
} from "@toby/core/chat-pipeline/tool-presentation";
import {
	applyChatEvent,
	shouldPersistChatEventInTranscript,
} from "@toby/core/chat-pipeline/transcript-reducer";
import type { TranscriptEntry } from "@toby/core/chat-pipeline/transcript-types";
import { createPluginStderrSplitter } from "@toby/core/integrations/plugins/client";

function apply(events: ChatEvent[]): TranscriptEntry[] {
	return events.reduce<TranscriptEntry[]>(
		(entries, event) => applyChatEvent(entries, event),
		[],
	);
}

function boxed(entry: TranscriptEntry | undefined) {
	if (entry?.kind !== "boxed_step") throw new Error("expected boxed_step");
	return entry;
}

describe("transcript reducer tool presentation", () => {
	it("stores display args and presentation on tool start", () => {
		const [entry] = apply([
			{
				type: "tool_call_start",
				blockKey: "b1",
				seq: 1,
				toolName: "webSearch",
				args: { query: "eu ai act", content: "x".repeat(10) },
			},
		]);
		const step = boxed(entry);
		expect(step.args).toEqual({ query: "eu ai act" });
		expect(step.presentation?.kind).toBe("search");
	});

	it("updates args in place when the same call starts again", () => {
		const entries = apply([
			{
				type: "tool_call_start",
				blockKey: "b1",
				seq: 1,
				toolName: "webSearch",
				args: {},
			},
			{
				type: "tool_call_start",
				blockKey: "b1",
				seq: 2,
				toolName: "webSearch",
				args: { query: "late args" },
			},
		]);
		expect(entries).toHaveLength(1);
		expect(boxed(entries[0]).args).toEqual({ query: "late args" });
	});

	it("does not persist progress events", () => {
		const progress: ChatEvent = {
			type: "tool_call_progress",
			blockKey: "b1",
			seq: 2,
			toolName: "webSearch",
			items: [{ id: "q0", label: "eu ai act", state: "running" }],
		};
		const before = apply([
			{
				type: "tool_call_start",
				blockKey: "b1",
				seq: 1,
				toolName: "webSearch",
				args: {},
			},
		]);
		expect(applyChatEvent(before, progress)).toEqual(before);
		expect(shouldPersistChatEventInTranscript(progress)).toBe(false);
	});

	it("uses the presentation summary and marks failures on completion", () => {
		const [ok] = apply([
			{
				type: "tool_call_start",
				blockKey: "b1",
				seq: 1,
				toolName: "webSearch",
				args: { query: "q" },
			},
			{
				type: "tool_call_complete",
				blockKey: "b1",
				seq: 2,
				toolName: "webSearch",
				args: { query: "q" },
				result: {
					results: [
						{ title: "A", url: "https://www.reuters.com/a" },
						{ title: "B", url: "https://europa.eu/b" },
						{ title: "C", url: "https://ft.com/c" },
					],
				},
			},
		]);
		expect(boxed(ok).body).toBe("3 results · reuters.com, europa.eu +1");
		expect(boxed(ok).failed).toBe(false);

		const [failed] = apply([
			{
				type: "tool_call_start",
				blockKey: "b2",
				seq: 1,
				toolName: "webSearch",
				args: {},
			},
			{
				type: "tool_call_complete",
				blockKey: "b2",
				seq: 2,
				toolName: "webSearch",
				args: {},
				result: { error: "rate limited" },
			},
		]);
		expect(boxed(failed).failed).toBe(true);
	});

	it("keeps per-run args when consecutive calls are grouped", () => {
		const entries = apply([
			{
				type: "tool_call_start",
				blockKey: "b1",
				seq: 1,
				toolName: "webSearch",
				args: { query: "one" },
			},
			{
				type: "tool_call_complete",
				blockKey: "b1",
				seq: 2,
				toolName: "webSearch",
				args: { query: "one" },
				result: { results: [] },
			},
			{
				type: "tool_call_start",
				blockKey: "b2",
				seq: 3,
				toolName: "webSearch",
				args: { query: "two" },
			},
		]);
		const runs = boxed(entries[0]).toolRuns ?? [];
		expect(runs.map((run) => run.args?.query)).toEqual(["one", "two"]);
		expect(runs[0]?.body).toBe("No results");
	});
});

describe("tool presentation helpers", () => {
	it("sanitizes args for display", () => {
		const args = sanitizeToolArgsForDisplay({
			query: ["a", "b", { nested: true }],
			long: "y".repeat(400),
			content: "secret file body",
			nested: { a: 1 },
			limit: 10,
			blank: "  ",
		});
		expect(args?.query).toEqual(["a", "b"]);
		expect(String(args?.long).length).toBe(240);
		expect(args?.content).toBeUndefined();
		expect(args?.nested).toBeUndefined();
		expect(args?.limit).toBe(10);
		expect(args?.blank).toBeUndefined();
		expect(sanitizeToolArgsForDisplay({})).toBeUndefined();
	});

	it("validates plugin presentations and lets them override", () => {
		expect(parseToolPresentation({ kind: "bogus" })).toBeUndefined();
		expect(
			parseToolPresentation({ kind: "list", verbs: ["only one"] }),
		).toEqual({
			kind: "list",
		});
		registerPluginToolPresentations([
			{
				name: "fetchOpenTasks",
				presentation: { kind: "list", argChips: ["limit"] },
			},
			{ name: "ignored", presentation: "nope" },
		]);
		expect(getToolPresentation("fetchOpenTasks")).toEqual({
			kind: "list",
			argChips: ["limit"],
		});
		expect(getToolPresentation("ignored")).toBeUndefined();
		clearPluginToolPresentations();
		expect(getToolPresentation("fetchOpenTasks")).toBeUndefined();
	});

	it("parses plugin progress defensively", () => {
		expect(
			parsePluginProgress({
				items: [
					{ id: "a", label: "Inbox", state: "done", detail: "3" },
					{ id: "b", label: "Work", state: "weird" },
					{ label: "no id" },
				],
				fraction: 0.5,
			}),
		).toEqual({
			items: [
				{ id: "a", label: "Inbox", state: "done", detail: "3" },
				{ id: "b", label: "Work", state: "running" },
			],
			fraction: 0.5,
		});
		expect(parsePluginProgress("garbage")).toEqual({});
	});

	it("only summarizes known result shapes", () => {
		expect(
			formatToolPresentationSummary("webSearch", { results: [] }, undefined),
		).toBe("No results");
		expect(
			formatToolPresentationSummary("webSearch", {}, "boom"),
		).toBeUndefined();
		expect(
			formatToolPresentationSummary("other", { results: [] }, undefined),
		).toBeUndefined();
	});
});

describe("tool progress plumbing", () => {
	it("accumulates item upserts within a tool call context", async () => {
		const emitted: Array<{
			items: Array<{ id: string; state: string }>;
			fraction?: number;
		}> = [];
		const reporter = createToolProgressAccumulator((update) =>
			emitted.push(update),
		);
		await runWithToolProgress(reporter, async () => {
			reportToolProgress({
				items: [{ id: "q0", label: "a", state: "running" }],
			});
			await Promise.resolve();
			reportToolProgress({
				items: [{ id: "q0", label: "a", state: "done" }],
				fraction: 2,
			});
		});
		reportToolProgress({
			items: [{ id: "outside", label: "x", state: "done" }],
		});
		expect(emitted).toHaveLength(2);
		expect(emitted[1]?.items).toEqual([
			{ id: "q0", label: "a", state: "done" },
		]);
		expect(emitted[1]?.fraction).toBe(1);
	});

	it("splits progress lines out of plugin stderr across chunks", () => {
		const updates: unknown[] = [];
		const splitter = createPluginStderrSplitter((u) => updates.push(u));
		let log = splitter.push('starting\n@@toby-progress {"items":[');
		log += splitter.push("]}\nmore log\n@@toby-progress not json\n");
		log += splitter.push("tail");
		log += splitter.flush();
		expect(updates).toEqual([{ items: [] }]);
		expect(log).toBe("starting\nmore log\ntail");
	});
});
