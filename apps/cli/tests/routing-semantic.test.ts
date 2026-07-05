import "./helpers/setup-mocks";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseCatalogLines } from "@toby/core/routing/catalog-parse";
import type { RoutingIndex } from "@toby/core/routing/index";
import { closeChatDbForTests } from "@toby/core/session-store";
import {
	clearPretreatmentCache,
	embedTextsMock,
	embedTextsQueue,
	generateTextMock,
	generateTextQueue,
} from "./helpers/setup-mocks";

afterEach(() => {
	clearPretreatmentCache();
	closeChatDbForTests();
	const dir = process.env.TOBY_DIR;
	if (dir?.startsWith(os.tmpdir()) && fs.existsSync(dir)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
	process.env.TOBY_DIR = undefined;
});

const { wrapUserPromptWithPretreatment } = await import(
	"@toby/core/ai/pretreatment"
);
const { getRoutingSkillMinScore, routeToolsAndSkills } = await import(
	"@toby/core/routing/index"
);

function testIndex(): RoutingIndex {
	return {
		catalogSignature: "test",
		model: "text-embedding-3-small",
		tools: [
			{
				entityType: "tool",
				id: "gmailSearch",
				text: "gmailSearch: Search Gmail",
				vector: [1, 0, 0],
			},
			{
				entityType: "tool",
				id: "todoistListTasks",
				text: "todoistListTasks: List tasks",
				vector: [0, 1, 0],
			},
		],
		skills: [
			{
				entityType: "skill",
				id: "inbox-triage",
				text: "inbox-triage: Triage inbox",
				vector: [0.7, 0.7, 0],
			},
		],
	};
}

describe("routeToolsAndSkills", () => {
	beforeEach(() => {
		(embedTextsMock as unknown as { mockClear?: () => void }).mockClear?.();
		embedTextsQueue.length = 0;
		process.env.TOBY_ROUTING_MIN_SCORE = "0.3";
	});

	it("selects tools and skills by query embedding similarity", async () => {
		embedTextsQueue.push([[0.95, 0.05, 0]]);

		const result = await routeToolsAndSkills({
			persona: {
				name: "Default",
				ai: { provider: "openai", model: "gpt-4.1" },
			},
			userText: "search my gmail inbox",
			toolIntegrationLabels: {
				gmailSearch: "Gmail",
				todoistListTasks: "Todoist",
			},
			allowedToolNamesLower: new Set(["gmailsearch", "todoistlisttasks"]),
			allowedSkillNamesLower: new Set(["inbox-triage"]),
			index: testIndex(),
		});

		expect(result.relevantTools).toEqual(["gmailSearch"]);
		expect(result.relevantSkills).toEqual(["inbox-triage"]);
		expect(result.relevantIntegrations).toEqual(["Gmail"]);
	});

	it("uses a higher threshold for skills than tools — weak skill match is dropped", async () => {
		// Query [1,0,0] vs candidate [0.32, 0.947, 0] → cosine ≈ 0.32.
		// 0.32 > tool min score (0.3 in beforeEach) but < skill min score (0.35 default).
		// The tool at the same similarity should still be selected.
		embedTextsQueue.push([[1, 0, 0]]);

		const index: RoutingIndex = {
			catalogSignature: "test",
			model: "text-embedding-3-small",
			tools: [
				{
					entityType: "tool",
					id: "weakTool",
					text: "weakTool: A tool that loosely matches",
					vector: [0.32, 0.947, 0],
				},
			],
			skills: [
				{
					entityType: "skill",
					id: "weak-skill",
					text: "weak-skill: A skill that loosely matches",
					vector: [0.32, 0.947, 0],
				},
			],
		};

		const result = await routeToolsAndSkills({
			persona: {
				name: "Default",
				ai: { provider: "openai", model: "gpt-4.1" },
			},
			userText: "plan my day",
			toolIntegrationLabels: { weakTool: "Test" },
			allowedToolNamesLower: new Set(["weaktool"]),
			allowedSkillNamesLower: new Set(["weak-skill"]),
			index,
		});

		expect(result.relevantTools).toEqual(["weakTool"]);
		expect(result.relevantSkills).toEqual([]);
	});

	it("getRoutingSkillMinScore defaults to 0.35 and respects env override", () => {
		const prev = process.env.TOBY_ROUTING_SKILL_MIN_SCORE;
		try {
			process.env.TOBY_ROUTING_SKILL_MIN_SCORE = undefined;
			expect(getRoutingSkillMinScore()).toBe(0.35);

			process.env.TOBY_ROUTING_SKILL_MIN_SCORE = "0.5";
			expect(getRoutingSkillMinScore()).toBe(0.5);
		} finally {
			if (prev === undefined) {
				process.env.TOBY_ROUTING_SKILL_MIN_SCORE = undefined;
			} else {
				process.env.TOBY_ROUTING_SKILL_MIN_SCORE = prev;
			}
		}
	});
});

describe("parseCatalogLines", () => {
	it("parses pretreatment catalog bullets", () => {
		const lines = parseCatalogLines(
			"- gmailSearch: Search mail (params: q)\n- todoistListTasks: List tasks",
		);
		expect(lines).toHaveLength(2);
		expect(lines[0]?.id).toBe("gmailSearch");
	});
});

describe("wrapUserPromptWithPretreatment semantic mode", () => {
	beforeEach(() => {
		generateTextQueue.length = 0;
		(generateTextMock as unknown as { mockClear?: () => void }).mockClear?.();
		(embedTextsMock as unknown as { mockClear?: () => void }).mockClear?.();
		embedTextsQueue.length = 0;
		embedTextsQueue.push([[0.95, 0.05, 0]]);
		process.env.TOBY_DIR = fs.mkdtempSync(
			path.join(os.tmpdir(), "toby-routing-test-"),
		);
		process.env.TOBY_SEMANTIC_ROUTING = "1";
		process.env.TOBY_ROUTING_MIN_SCORE = "0.3";
	});

	it("does not call generateText and routes tools from the index", async () => {
		const r = await wrapUserPromptWithPretreatment({
			priorMessages: [],
			rawUserText: "search gmail for invoices",
			integrationLabels: "Gmail",
			isFirstTurn: true,
			toolsCatalogText: "- gmailSearch: Search\n- todoistListTasks: List",
			allowedToolNamesLower: new Set(["gmailsearch", "todoistlisttasks"]),
			toolIntegrationLabels: {
				gmailSearch: "Gmail",
				todoistListTasks: "Todoist",
			},
			routingIndex: testIndex(),
		});

		expect(generateTextMock).not.toHaveBeenCalled();
		expect(embedTextsMock).toHaveBeenCalled();
		expect(r.spec?.relevantTools).toContain("gmailSearch");
		expect(r.content).toContain("User request (verbatim):");
	});

	it("re-embeds on non-trivial follow-ups instead of delta LLM", async () => {
		const prior = {
			rawUserText: "list tasks",
			spec: {
				goal: "List tasks",
				mustDo: [],
				mustNotDo: [],
				assumptions: [],
				openQuestions: [],
				relevantIntegrations: ["Todoist"],
				relevantSkills: [],
				relevantTools: ["todoistListTasks"],
				sessionName: "",
			},
		};
		embedTextsMock.mockResolvedValue([[0.95, 0.05, 0]]);

		const r = await wrapUserPromptWithPretreatment({
			priorMessages: [{ role: "user", content: "prior" }],
			rawUserText: "search gmail instead for invoices",
			integrationLabels: "Gmail + Todoist",
			isFirstTurn: false,
			priorPretreatment: prior,
			toolsCatalogText: "- gmailSearch: Search\n- todoistListTasks: List",
			allowedToolNamesLower: new Set(["gmailsearch", "todoistlisttasks"]),
			toolIntegrationLabels: {
				gmailSearch: "Gmail",
				todoistListTasks: "Todoist",
			},
			routingIndex: testIndex(),
		});

		expect(generateTextMock).not.toHaveBeenCalled();
		expect(r.spec?.relevantTools).toContain("gmailSearch");
	});
});
