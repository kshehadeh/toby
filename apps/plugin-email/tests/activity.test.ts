import { describe, expect, it } from "bun:test";
import type { FetchMessageObject } from "imapflow";
import {
	activityTextPart,
	emailThreadId,
	oldestSince,
	toEmailActivity,
	trimEmailSnippet,
} from "../src/activity";
import { TOOL_DEFINITIONS, executeTool } from "../src/tools";

const since = "2026-01-01T00:00:00Z";
function message(
	uid: number,
	date: string,
	extra: Partial<NonNullable<FetchMessageObject["envelope"]>> = {},
): FetchMessageObject {
	return {
		seq: uid,
		uid,
		envelope: {
			date: new Date(date),
			messageId: `<${uid}@example.com>`,
			from: [{ address: "friend@example.com", name: "Friend" }],
			to: [{ address: "SELF@example.com" }],
			subject: "Hello",
			...extra,
		},
		flags: new Set(["\\Seen", "\\Answered", "\\Flagged"]),
	};
}

describe("email recent activity", () => {
	it("defaults to 200 and enforces the 1000-message ceiling", () => {
		const messages = Array.from({ length: 1001 }, (_, uid) => ({
			mailbox: "INBOX",
			message: message(uid, since),
		}));
		expect(toEmailActivity(messages, [], since).observations).toHaveLength(200);
		expect(
			toEmailActivity(messages, [], since, 2000).observations,
		).toHaveLength(1000);
	});
	it("derives normalized root thread ids with fallbacks", () => {
		expect(
			emailThreadId(
				"<ROOT@Example.COM> <later@example.com>",
				"<parent@example.com>",
				"<own@example.com>",
			),
		).toBe("root@example.com");
		expect(emailThreadId("", "<PARENT@Example.COM>", "<own@example.com>")).toBe(
			"parent@example.com",
		);
		expect(emailThreadId("", "", "<OWN@Example.COM>")).toBe("own@example.com");
		expect(emailThreadId()).toBeUndefined();
	});
	it("strips quotes and signatures and bounds plain snippets", () => {
		for (const tail of [
			"> quoted",
			"On Tuesday Alice wrote:",
			"-- ",
			"Sent from my iPhone",
			"From: Alice",
		]) {
			expect(trimEmailSnippet(`New reply\n\n${tail}\nOld text`)).toBe(
				"New reply",
			);
		}
		expect(trimEmailSnippet("x".repeat(3000))).toHaveLength(2000);
	});
	it("maps direction, actors, flags, bulk and direct", () => {
		const inbound = message(1, since);
		inbound.headers = Buffer.from(
			"References: <ROOT@Example.com>\r\nList-Id: newsletter\r\n",
		);
		const outbound = message(2, "2026-01-02T01:00:00Z", {
			from: [{ address: "self@example.com" }],
			to: [{ address: "friend@example.com" }],
			cc: [{ address: "cc@example.com" }],
		});
		const result = toEmailActivity(
			[
				{ mailbox: "INBOX", message: inbound },
				{ mailbox: "Sent", message: outbound },
			],
			["SELF@example.com"],
			since,
		);
		expect(result.self.emails).toEqual(["self@example.com"]);
		expect(result.observations[1]).toMatchObject({
			direction: "outbound",
			facts: { mailbox: "Sent", direct: false },
			actors: [
				{ role: "from", email: "self@example.com" },
				{ role: "to", email: "friend@example.com" },
				{ role: "cc", email: "cc@example.com" },
			],
		});
		expect(result.observations[0]).toMatchObject({
			direction: "inbound",
			threadId: "root@example.com",
			facts: {
				bulk: true,
				direct: true,
				seen: true,
				answered: true,
				flagged: true,
			},
		});
	});
	it("deduplicates across folders, orders oldest first, filters since and caps", () => {
		const newest = message(3, "2026-01-03T00:00:00Z");
		const result = toEmailActivity(
			[
				{ mailbox: "INBOX", message: message(0, "2025-12-31T23:59:59Z") },
				{ mailbox: "INBOX", message: message(1, since, { messageId: "" }) },
				{ mailbox: "Sent", message: newest },
				{ mailbox: "INBOX", message: newest },
			],
			[],
			since,
			2,
		);
		expect(result.observations.map((o) => o.externalId)).toEqual([
			"INBOX:1",
			"<3@example.com>",
		]);
		expect(
			toEmailActivity([{ mailbox: "INBOX", message: newest }], [], since, 1)
				.observations,
		).toHaveLength(1);
		expect(() => toEmailActivity([], [], "bad")).toThrow("since");
	});
	it("pages from the oldest messages at or after the exact cutoff", () => {
		const cutoff = Date.parse(since);
		const picked = oldestSince(
			[
				message(4, "2026-01-04T00:00:00Z"),
				message(1, "2025-12-31T12:00:00Z"),
				message(3, "2026-01-03T00:00:00Z"),
				message(2, since),
			],
			cutoff,
			2,
		);
		expect(picked.map((m) => m.uid)).toEqual([2, 3]);
	});
	it("selects inline plain text without traversing attachments", () => {
		expect(
			activityTextPart({
				type: "multipart/mixed",
				childNodes: [
					{ type: "text/plain", part: "1", disposition: "attachment" },
					{ type: "text/html", part: "2" },
					{ type: "text/plain", part: "3" },
				],
			})?.part,
		).toBe("3");
		expect(
			activityTextPart({
				type: "message/rfc822",
				childNodes: [{ type: "text/plain" }],
			}),
		).toBeUndefined();
	});
	it("tags the tool and follows dry-run and input-error conventions without a database", async () => {
		expect(
			TOOL_DEFINITIONS.find((t) => t.name === "getRecentActivity"),
		).toMatchObject({ standardTool: "activity.recent", readOnly: true });
		expect(
			await executeTool("getRecentActivity", {}, {}, true, undefined),
		).toMatchObject({ result: { dryRun: true } });
		expect(
			await executeTool(
				"getRecentActivity",
				{ since: "bad" },
				{},
				false,
				undefined,
			),
		).toMatchObject({ result: { error: expect.stringContaining("since") } });
	});
});
