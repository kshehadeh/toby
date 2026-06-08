import { createChatTurnAbortError } from "@toby/core/abort";
import { wrapUserPromptWithPretreatment } from "@toby/core/ai/pretreatment";
import { expandPromptNode } from "@toby/core/chat-pipeline/nodes/expand-prompt";
import type {
	InitedTurn,
	TurnContext,
} from "@toby/core/chat-pipeline/pipeline";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const prevSemantic = process.env.TOBY_SEMANTIC_ROUTING;

beforeEach(() => {
	generateTextMock.mockReset();
	process.env.TOBY_SEMANTIC_ROUTING = "0";
	process.env.TOBY_DISABLE_PRETREATMENT = undefined;
});

afterEach(() => {
	if (prevSemantic === undefined) {
		process.env.TOBY_SEMANTIC_ROUTING = undefined;
	} else {
		process.env.TOBY_SEMANTIC_ROUTING = prevSemantic;
	}
});

describe("pretreatment abort propagation", () => {
	it("wrapUserPromptWithPretreatment throws when abortSignal is already aborted", async () => {
		const ac = new AbortController();
		ac.abort();
		await expect(
			wrapUserPromptWithPretreatment({
				priorMessages: [],
				rawUserText: "list my open tasks",
				integrationLabels: "Todoist",
				isFirstTurn: true,
				abortSignal: ac.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(generateTextMock).not.toHaveBeenCalled();
	});

	it("wrapUserPromptWithPretreatment rethrows abort from generateText", async () => {
		generateTextMock.mockRejectedValueOnce(createChatTurnAbortError());
		const ac = new AbortController();
		await expect(
			wrapUserPromptWithPretreatment({
				priorMessages: [],
				rawUserText: "list my open tasks in Todoist",
				integrationLabels: "Todoist",
				isFirstTurn: true,
				toolsCatalogText: "todoistListTasks — list tasks",
				allowedToolNamesLower: new Set(["todoistlisttasks"]),
				abortSignal: ac.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
	});

	it("expandPromptNode throws when pretreatment is aborted", async () => {
		const ac = new AbortController();
		ac.abort();
		const input: InitedTurn = {
			rawUserText: "hello",
			priorMessages: [],
			isFirstTurn: true,
			localSkills: [],
			toolCatalog: {
				catalogText: "(none)",
				allowedToolNamesLower: new Set(),
				allToolNames: [],
				toolIntegrationLabels: {},
			},
			willPretreat: true,
			integrationLabel: "Gmail",
			routingIndex: null,
		};
		const ctx: TurnContext = {
			persona: {
				name: "Default",
				instructions: "",
				ai: { provider: "openai", model: "gpt-4o-mini" },
			},
			modules: [],
			dryRun: true,
			emit: () => {},
			nextSeq: () => 1,
			abortSignal: ac.signal,
			emitPersistLifecycle: false,
		};
		await expect(expandPromptNode.run(input, ctx)).rejects.toMatchObject({
			name: "AbortError",
		});
	});
});
