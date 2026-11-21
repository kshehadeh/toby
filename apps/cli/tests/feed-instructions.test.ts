import { beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import { getDashboardFeedStatePath } from "@toby/core/config/index";
import {
	buildFeedPersonalization,
	formatInstructionsForPrompt,
	formatInstructionsReminder,
	formatPersonalizationForPrompt,
	personalizationSignature,
} from "@toby/core/feed/personalization";
import {
	buildFeedSystemPrompt,
	formatCandidatesForPrompt,
} from "@toby/core/feed/rank";
import {
	FEED_INSTRUCTION_MAX_CHARS,
	type FeedState,
	addInstruction,
	clearFeedStateCache,
	loadFeedState,
	normalizeInstructionText,
	pruneFeedState,
	removeInstruction,
	setInstructionEnabled,
} from "@toby/core/feed/state";
import { handleWebRequest } from "@toby/core/web/routes";

const NOW = new Date("2026-11-16T15:00:00Z");
const EMPTY: FeedState = {
	items: {},
	notified: {},
	feedback: [],
	instructions: [],
};
const BASE = "http://127.0.0.1/api/dashboard/feed/instructions";

beforeEach(() => {
	clearFeedStateCache();
	fs.rmSync(getDashboardFeedStatePath(), { force: true });
});

function json(method: string, url: string, body?: unknown): Request {
	return new Request(url, {
		method,
		headers: { "Content-Type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

describe("Feed instructions state", () => {
	it("adds, toggles, and removes instructions; pruning keeps them", () => {
		let state = addInstruction(EMPTY, "Hide GitHub notifications", NOW, "a");
		state = addInstruction(state, "Rank mail from Sam first", NOW, "b");
		expect(state.instructions.map((i) => i.id)).toEqual(["a", "b"]);
		expect(state.instructions.every((i) => i.enabled)).toBe(true);

		state = setInstructionEnabled(state, "a", false);
		expect(state.instructions[0]?.enabled).toBe(false);

		const later = new Date(NOW.getTime() + 365 * 24 * 60 * 60 * 1000);
		expect(pruneFeedState(state, later).instructions).toHaveLength(2);

		state = removeInstruction(state, "a");
		expect(state.instructions.map((i) => i.id)).toEqual(["b"]);
	});

	it("normalizes text and rejects empty or overlong instructions", () => {
		expect(normalizeInstructionText("  Skip   newsletters \n")).toEqual({
			ok: true,
			text: "Skip newsletters",
		});
		expect(normalizeInstructionText("   ").ok).toBe(false);
		expect(normalizeInstructionText(42).ok).toBe(false);
		expect(
			normalizeInstructionText("x".repeat(FEED_INSTRUCTION_MAX_CHARS + 1)).ok,
		).toBe(false);
	});

	it("sends only enabled instructions to the ranker as hard rules", () => {
		let state = addInstruction(EMPTY, "Always include Sam's email", NOW, "a");
		state = addInstruction(state, "Ignore build failures", NOW, "b");
		state = setInstructionEnabled(state, "b", false);
		const p = buildFeedPersonalization(state, { listMemories: () => [] });
		expect(p.instructions).toEqual(["Always include Sam's email"]);

		const rules = formatInstructionsForPrompt(p);
		expect(rules).toContain("USER INSTRUCTIONS");
		expect(rules).toContain("hard filter");
		expect(rules).toContain("- Always include Sam's email");
		expect(rules).not.toContain("Ignore build failures");
		expect(formatPersonalizationForPrompt(p)).not.toContain("Sam's email");

		const prompt = buildFeedSystemPrompt(
			{ name: "Home", instructions: "", promptMode: "add" } as never,
			NOW,
			p,
		);
		// Instructions sit before the default rules so they read as overrides.
		expect(prompt.indexOf("USER INSTRUCTIONS")).toBeLessThan(
			prompt.indexOf("Your job:"),
		);
		expect(formatInstructionsReminder(p)).toContain(
			"Always include Sam's email",
		);

		const none = buildFeedPersonalization(EMPTY, { listMemories: () => [] });
		expect(formatInstructionsForPrompt(none)).toBe("");
		expect(formatInstructionsReminder(none)).toBe("");
		expect(personalizationSignature(p)).not.toBe(
			personalizationSignature(none),
		);
	});

	it("shows the ranker each candidate's source app and assignment", () => {
		const base = {
			category: "tasks" as const,
			providerName: "todoist",
			providerDisplayName: "Todoist",
			itemId: "1",
			signals: [],
			score: 1,
		};
		const text = formatCandidatesForPrompt([
			{ ...base, id: "a", title: "Mine", subtitle: "Inbox" },
			{
				...base,
				id: "b",
				title: "Theirs",
				subtitle: "Family",
				task: { assignment: "someone_else", shared: true },
			},
			{
				...base,
				id: "c",
				title: "Reminder",
				providerName: "applereminders",
				providerDisplayName: undefined,
			},
		]);
		expect(text).toContain("source: Todoist\n   from/list: Inbox");
		expect(text).toContain("assigned: to someone else (shared list)");
		expect(text).toContain("source: applereminders");
		expect(text.match(/assigned:/g)).toHaveLength(1);
	});
});

describe("Feed instructions API", () => {
	it("lists, adds, toggles, and deletes instructions and persists them", async () => {
		const empty = await handleWebRequest(new Request(BASE));
		expect(empty.status).toBe(200);
		expect(await empty.json()).toEqual({ instructions: [] });

		const created = await handleWebRequest(
			json("POST", BASE, { text: "  Put tasks due today above meetings " }),
		);
		expect(created.status).toBe(201);
		const { instructions } = (await created.json()) as {
			instructions: { id: string; text: string; enabled: boolean }[];
		};
		expect(instructions).toHaveLength(1);
		const added = instructions[0];
		expect(added?.text).toBe("Put tasks due today above meetings");
		expect(added?.enabled).toBe(true);
		const id = added?.id ?? "";

		const toggled = await handleWebRequest(
			json("PATCH", `${BASE}/${id}`, { enabled: false }),
		);
		expect(toggled.status).toBe(200);
		clearFeedStateCache();
		expect(loadFeedState().instructions[0]?.enabled).toBe(false);

		const removed = await handleWebRequest(json("DELETE", `${BASE}/${id}`));
		expect(await removed.json()).toEqual({ instructions: [] });
	});

	it("rejects bad input and unknown ids", async () => {
		expect(
			(await handleWebRequest(json("POST", BASE, { text: " " }))).status,
		).toBe(400);
		expect(
			(
				await handleWebRequest(
					json("PATCH", `${BASE}/missing`, { enabled: true }),
				)
			).status,
		).toBe(404);
		const created = await handleWebRequest(
			json("POST", BASE, { text: "Skip news" }),
		);
		const id = ((await created.json()) as { instructions: { id: string }[] })
			.instructions[0]?.id;
		expect(
			(
				await handleWebRequest(
					json("PATCH", `${BASE}/${id}`, { enabled: "no" }),
				)
			).status,
		).toBe(400);
	});
});
