import { wrapUserPromptWithPretreatment } from "@toby/core/ai/pretreatment";
import { parseCatalogLines } from "@toby/core/routing/catalog-parse";
import type { RoutingIndex } from "@toby/core/routing/index";
import {
	getRoutingSkillMinScore,
	routeToolsAndSkills,
} from "@toby/core/routing/index";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { embedTextsMock } = vi.hoisted(() => ({
	embedTextsMock: vi.fn(),
}));

vi.mock("@toby/core/routing/embeddings", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@toby/core/routing/embeddings")>();
	return {
		...actual,
		embedTexts: (...args: unknown[]) => embedTextsMock(...args),
		createEmbeddingModelForPersona: () => ({}) as never,
	};
});

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
		embedTextsMock.mockReset();
		process.env.TOBY_ROUTING_MIN_SCORE = "0.3";
	});

	it("selects tools and skills by query embedding similarity", async () => {
		embedTextsMock.mockResolvedValueOnce([[0.95, 0.05, 0]]);

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
		embedTextsMock.mockResolvedValueOnce([[1, 0, 0]]);

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
			delete process.env.TOBY_ROUTING_SKILL_MIN_SCORE;
			expect(getRoutingSkillMinScore()).toBe(0.35);

			process.env.TOBY_ROUTING_SKILL_MIN_SCORE = "0.5";
			expect(getRoutingSkillMinScore()).toBe(0.5);
		} finally {
			if (prev === undefined) {
				delete process.env.TOBY_ROUTING_SKILL_MIN_SCORE;
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
	const { generateTextMock } = vi.hoisted(() => ({
		generateTextMock: vi.fn(),
	}));

	vi.mock("ai", async (importOriginal) => {
		const actual = await importOriginal<typeof import("ai")>();
		return {
			...actual,
			generateText: (...args: unknown[]) => generateTextMock(...args),
		};
	});

	beforeEach(() => {
		generateTextMock.mockReset();
		embedTextsMock.mockReset();
		process.env.TOBY_SEMANTIC_ROUTING = "1";
		process.env.TOBY_ROUTING_MIN_SCORE = "0.3";
		embedTextsMock.mockResolvedValue([[0.95, 0.05, 0]]);
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
