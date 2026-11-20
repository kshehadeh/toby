import { describe, expect, it } from "bun:test";
import type { DashboardCategorySummary } from "@toby/core/dashboard/types";
import {
	FEED_SOURCE_FALLBACK_MS,
	candidatesWithFallback,
} from "@toby/core/feed/collect";
import {
	type RawFeedCandidate,
	feedbackKeyFor,
	isBulkEmail,
	normalizeFeedbackTitle,
	prefilterCandidates,
} from "@toby/core/feed/prefilter";
import { isBulkMail, parseHeaderBlock } from "../../plugin-email/src/client";

const NOW = new Date("2026-11-20T15:00:00Z");
const HOUR = 60 * 60 * 1000;

function email(partial: Partial<RawFeedCandidate>): RawFeedCandidate {
	return {
		id: `email:email:${partial.itemId ?? "1"}`,
		category: "email",
		providerName: "email",
		itemId: "1",
		title: "Hello",
		subtitle: "Alex <alex@example.com>",
		timestamp: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
		...partial,
	};
}

describe("feed email scoring", () => {
	it("trusts provider bulk facts over the sender regex", () => {
		// Header-detected list mail from an address the regex misses.
		expect(
			isBulkEmail(
				email({
					subtitle: "Capital One <capitalone@notification.capitalone.com>",
					email: { bulk: true },
				}),
			),
		).toBe(true);
		// A person at a "team@" address with no list headers.
		expect(
			isBulkEmail(
				email({ subtitle: "team@startup.io", email: { bulk: false } }),
			),
		).toBe(false);
		// No facts: fall back to the sender regex.
		expect(isBulkEmail(email({ subtitle: "noreply@shop.com" }))).toBe(true);
	});

	it("ranks personal mail well above bulk and above undated tasks", () => {
		const out = prefilterCandidates(
			[
				email({ itemId: "bulk", email: { bulk: true, unread: true } }),
				email({ itemId: "person", email: { bulk: false, unread: true } }),
				{
					id: "tasks:p:t",
					category: "tasks",
					providerName: "reminders",
					itemId: "t",
					title: "Call someone",
				},
			],
			NOW,
		);
		expect(out.map((c) => c.itemId)).toEqual(["person", "t", "bulk"]);
		const person = out[0];
		expect(person?.signals).toContain("personal email from a person");
		expect((person?.score ?? 0) - (out[2]?.score ?? 0)).toBeGreaterThan(40);
	});

	it("boosts known senders, direct mail, and threads awaiting a reply", () => {
		const [awaiting, plain] = prefilterCandidates(
			[
				email({ itemId: "plain", email: { bulk: false, unread: true } }),
				email({
					itemId: "awaiting",
					timestamp: new Date(NOW.getTime() - 26 * HOUR).toISOString(),
					email: {
						bulk: false,
						unread: false,
						awaitingReply: true,
						knownSender: true,
						direct: true,
					},
				}),
			],
			NOW,
		);
		expect(awaiting?.itemId).toBe("awaiting");
		expect(awaiting?.signals).toEqual(
			expect.arrayContaining([
				"read but not replied to",
				"from someone the user has emailed before",
				"sent directly to the user",
			]),
		);
		expect(plain?.itemId).toBe("plain");
	});

	it("caps how many bulk emails reach the ranker", () => {
		const bulk = Array.from({ length: 12 }, (_, i) =>
			email({ itemId: `b${i}`, email: { bulk: true } }),
		);
		const person = email({ itemId: "p", email: { bulk: false } });
		const out = prefilterCandidates([...bulk, person], NOW);
		expect(out.filter((c) => c.itemId.startsWith("b"))).toHaveLength(4);
		expect(out[0]?.itemId).toBe("p");
	});
});

describe("feed feedback keys", () => {
	it("keys calendar and tasks by normalized title, not calendar/project", () => {
		const a = feedbackKeyFor({
			category: "calendar",
			providerName: "applecalendar",
			subtitle: "Calendar",
			title: "Grooming: Purchase & Acquisition Squad",
		});
		const b = feedbackKeyFor({
			category: "calendar",
			providerName: "applecalendar",
			subtitle: "Calendar",
			title: "UA <> Factory - Working Session",
		});
		expect(a).toBe(
			"calendar:applecalendar:title:grooming purchase acquisition squad",
		);
		expect(a).not.toBe(b);
		expect(
			feedbackKeyFor({
				category: "tasks",
				providerName: "todoist",
				subtitle: "Financial",
				title: "Cancel Amex Credit Card",
			}),
		).toBe("tasks:todoist:title:cancel amex credit card");
	});

	it("groups titles that differ only by numbers and dates", () => {
		expect(normalizeFeedbackTitle("Standup 11/20")).toBe(
			normalizeFeedbackTitle("Standup 11/21"),
		);
	});

	it("only penalizes events with a matching title", () => {
		const meeting = (itemId: string, title: string): RawFeedCandidate => ({
			id: `calendar:applecalendar:${itemId}`,
			category: "calendar",
			providerName: "applecalendar",
			itemId,
			title,
			subtitle: "Calendar",
			timestamp: new Date(NOW.getTime() + 2 * HOUR).toISOString(),
			event: { attendeeCount: 4, notes: "Agenda" },
		});
		const counts = new Map([["calendar:applecalendar:title:grooming", 1]]);
		const out = prefilterCandidates(
			[meeting("g", "Grooming"), meeting("w", "Working Session")],
			NOW,
			counts,
		);
		const byId = new Map(out.map((c) => [c.itemId, c]));
		expect(byId.get("g")?.signals.join(" ")).toContain("not relevant");
		expect(byId.get("w")?.signals.join(" ")).not.toContain("not relevant");
	});
});

describe("feed source fallback", () => {
	const summary = (
		items: DashboardCategorySummary["items"],
		error?: string,
	): DashboardCategorySummary => ({
		count: items.length,
		items: items.map((i) => ({ ...i, providerName: "email" })),
		groups: [],
		generatedAt: NOW.toISOString(),
		sources: [
			{
				providerName: "email",
				providerDisplayName: "Email",
				summary: {
					count: items.length,
					items,
					generatedAt: NOW.toISOString(),
					...(error ? { error } : {}),
				},
			},
		],
	});

	it("reuses a provider's last good items when its fetch fails", () => {
		const store = new Map();
		const t0 = NOW.getTime();
		const good = candidatesWithFallback(
			"email",
			summary([{ id: "1:INBOX", title: "Hi", email: { bulk: false } }]),
			t0,
			store,
		);
		expect(good).toHaveLength(1);
		expect(good[0]?.email?.bulk).toBe(false);

		const failed = candidatesWithFallback(
			"email",
			summary([], "IMAP connection failed"),
			t0 + HOUR,
			store,
		);
		expect(failed.map((c) => c.itemId)).toEqual(["1:INBOX"]);

		const expired = candidatesWithFallback(
			"email",
			summary([], "IMAP connection failed"),
			t0 + FEED_SOURCE_FALLBACK_MS + HOUR,
			store,
		);
		expect(expired).toHaveLength(0);
	});

	it("an empty successful fetch replaces the last good items", () => {
		const store = new Map();
		const t0 = NOW.getTime();
		candidatesWithFallback(
			"email",
			summary([{ id: "1:INBOX", title: "Hi" }]),
			t0,
			store,
		);
		expect(candidatesWithFallback("email", summary([]), t0 + 1, store)).toEqual(
			[],
		);
		expect(
			candidatesWithFallback("email", summary([], "down"), t0 + 2, store),
		).toEqual([]);
	});
});

describe("email plugin bulk detection", () => {
	it("parses folded header blocks", () => {
		const headers = parseHeaderBlock(
			"List-Unsubscribe: <mailto:u@x.com>,\r\n <https://x.com/u>\r\nPrecedence: bulk\r\n",
		);
		expect(headers.get("list-unsubscribe")).toBe(
			"<mailto:u@x.com>, <https://x.com/u>",
		);
		expect(headers.get("precedence")).toBe("bulk");
	});

	it("flags list, bulk, and automated mail", () => {
		expect(isBulkMail(parseHeaderBlock("List-Id: <news.example.com>"))).toBe(
			true,
		);
		expect(isBulkMail(parseHeaderBlock("Precedence: list"))).toBe(true);
		expect(isBulkMail(parseHeaderBlock("Auto-Submitted: auto-generated"))).toBe(
			true,
		);
		expect(isBulkMail(parseHeaderBlock("Auto-Submitted: no"))).toBe(false);
		expect(isBulkMail(new Map(), "noreply@service.com")).toBe(true);
		expect(isBulkMail(new Map(), "kiera@realmgroup.io")).toBe(false);
	});
});
