import type { TranscriptEntry } from "@toby/core/chat-pipeline/transcript-types";
import { insertTurnWorkSummary } from "@toby/core/chat-pipeline/turn-work-summary";
import {
	deserializeTranscriptRow,
	serializeTranscriptEntry,
} from "@toby/core/transcript-persist";
import { describe, expect, it } from "bun:test";

describe("turn_work transcript entry", () => {
	it("round-trips through SQLite serialization", () => {
		const entry: TranscriptEntry = { kind: "turn_work", durationMs: 13_250 };
		const row = serializeTranscriptEntry(entry);
		expect(row.kind).toBe("turn_work");
		expect(deserializeTranscriptRow(row)).toEqual(entry);
	});

	it("inserts duration before the assistant reply when work steps exist", () => {
		const entries: TranscriptEntry[] = [
			{ kind: "user", text: "Hello" },
			{
				kind: "boxed_step",
				id: "life-1",
				seq: 1,
				variant: "lifecycle",
				header: "Working",
				body: "Done.",
			},
			{
				kind: "boxed_step",
				id: "asst-1",
				seq: 2,
				variant: "assistant",
				header: "Toby",
				body: "Hi there",
			},
		];

		const next = insertTurnWorkSummary(entries, 0, 13_000);
		expect(next.map((entry) => entry.kind)).toEqual([
			"user",
			"boxed_step",
			"turn_work",
			"boxed_step",
		]);
		expect(next[2]).toEqual({ kind: "turn_work", durationMs: 13_000 });
	});

	it("inserts duration even when a turn had no work steps", () => {
		const entries: TranscriptEntry[] = [
			{ kind: "user", text: "Hello" },
			{
				kind: "boxed_step",
				id: "asst-1",
				seq: 1,
				variant: "assistant",
				header: "Toby",
				body: "Hi there",
			},
		];

		const next = insertTurnWorkSummary(entries, 0, 900);
		expect(next.map((entry) => entry.kind)).toEqual([
			"user",
			"turn_work",
			"boxed_step",
		]);
		expect(next[1]).toEqual({ kind: "turn_work", durationMs: 900 });
	});
});
