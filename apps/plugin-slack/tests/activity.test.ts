import { describe, expect, it } from "bun:test";
import { slackActivityThreadTs, toSlackActivity } from "../src/activity";
import type { SlackMessageSearchHit } from "../src/client";
import { slackAfterDate } from "../src/mentions";
import { TOOL_DEFINITIONS, executeTool } from "../src/tools";

const since = "2026-01-01T00:00:00Z";
const ts = String(Date.parse(since) / 1000);
const hit: SlackMessageSearchHit = {
	channelId: "D123",
	ts,
	text: "Hi <@U123>\nI'll send it tomorrow.",
	user: "UOTHER",
	username: "alice",
	teamId: "T123",
	isDirect: true,
	permalink: "https://slack.com/archives/D123/p123?thread_ts=123.456",
};

describe("Slack recent activity", () => {
	it("defaults to 200 and enforces the 1000-message ceiling", () => {
		const hits = Array.from({ length: 1001 }, (_, n) => ({
			...hit,
			ts: String(Number(ts) + n),
		}));
		expect(toSlackActivity(hits, "U123", since).observations).toHaveLength(200);
		expect(
			toSlackActivity(hits, "U123", since, 2000).observations,
		).toHaveLength(1000);
	});
	it("uses explicit thread ts, permalink thread ts, then message ts", () => {
		expect(slackActivityThreadTs({ ...hit, threadTs: "456.789" })).toBe(
			"456.789",
		);
		expect(slackActivityThreadTs(hit)).toBe("123.456");
		expect(slackActivityThreadTs({ ...hit, permalink: "bad" })).toBe(ts);
	});
	it("maps author and mentions with team scope, cleans text and preserves direction", () => {
		const result = toSlackActivity(
			[hit, { ...hit, ts: String(Number(ts) + 10), user: "U123" }],
			"U123",
			since,
		);
		expect(result.self.handles).toEqual(["U123"]);
		expect(result.observations[1].direction).toBe("outbound");
		expect(result.observations[0]).toMatchObject({
			externalId: `D123:${ts}`,
			threadId: "D123:123.456",
			direction: "inbound",
			occurredAt: "2026-01-01T00:00:00.000Z",
			title: "Hi @you",
			excerpt: "Hi @you I'll send it tomorrow.",
			facts: { isDm: true },
			actors: [
				{ role: "author", handle: "UOTHER", name: "alice", scope: "T123" },
				{ role: "mentioned", handle: "U123", scope: "T123" },
			],
		});
	});
	it("deduplicates, filters exact since, bounds text and caps oldest first", () => {
		const result = toSlackActivity(
			[
				hit,
				hit,
				{ ...hit, ts: String(Number(ts) - 1) },
				{ ...hit, ts: String(Number(ts) + 1), text: "x".repeat(3000) },
			],
			"U123",
			since,
			1,
		);
		expect(result.observations).toHaveLength(1);
		expect(result.observations[0].externalId).toBe(`D123:${ts}`);
		const long = toSlackActivity(
			[{ ...hit, ts: String(Number(ts) + 1), text: "x".repeat(3000) }],
			"U123",
			since,
		);
		expect(long.observations[0].excerpt).toHaveLength(2000);
		expect(long.observations[0].title).toHaveLength(1000);
		expect(
			toSlackActivity([hit, hit], "U123", since).observations,
		).toHaveLength(1);
		expect(() => toSlackActivity([], "U123", "bad")).toThrow("since");
		expect(() => toSlackActivity([], "U123", since, 0)).toThrow("limit");
	});
	it("steps back a day for the exclusive after date", () => {
		const date = new Date(2026, 0, 1, 12);
		expect(slackAfterDate(date, 0)).toBe("2025-12-31");
	});
	it("tags the tool, handles dry-run and rejects malformed inputs", async () => {
		expect(
			TOOL_DEFINITIONS.find((t) => t.name === "getRecentActivity"),
		).toMatchObject({ standardTool: "activity.recent", readOnly: true });
		expect(await executeTool("getRecentActivity", {}, {}, true)).toMatchObject({
			result: { dryRun: true },
		});
		await expect(
			executeTool("getRecentActivity", { since: "bad" }, {}, false),
		).rejects.toThrow("since");
	});
});
