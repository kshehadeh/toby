import { beforeEach, describe, expect, it, mock } from "bun:test";
import { z } from "zod";

/**
 * `structuredOutput: "required"` must never fall back to free-form text:
 * a structured miss is a node error, and only one model call is made.
 */
const calls: { output?: unknown }[] = [];
let structuredBehavior: "throw" | "ok" = "throw";

const actual = { ...(await import("ai")) };

mock.module("ai", () => {
	return {
		...actual,
		generateText: async (opts: { output?: unknown }) => {
			calls.push(opts);
			if (opts.output) {
				if (structuredBehavior === "throw")
					throw new Error("schema not supported");
				return { output: { items: [] }, usage: {} };
			}
			return { text: '{"items":[]}', usage: {} };
		},
	};
});

mock.module("@toby/core/ai/model-factory", () => ({
	createModelForPersona: () => ({}),
}));

const { runLlmPrompterNode } = await import(
	"@toby/core/flows/nodes/llm-prompter"
);
const { FlowNodeError } = await import("@toby/core/flows/types");

const schema = z.object({ items: z.array(z.string()) });
const runtime = {
	persona: {
		name: "T",
		instructions: "",
		promptMode: "add" as const,
		ai: { provider: "openrouter", model: "x" },
	},
	bag: {},
} as never;

function node(structuredOutput?: "preferred" | "required") {
	return {
		id: "rank",
		type: "llm_prompter" as const,
		schema,
		systemPrompt: () => "s",
		userPrompt: () => "u",
		...(structuredOutput ? { structuredOutput } : {}),
	};
}

describe("llm_prompter structuredOutput", () => {
	beforeEach(() => {
		calls.length = 0;
	});

	it("required: structured failure is an error with no free-form retry", async () => {
		structuredBehavior = "throw";
		await expect(
			runLlmPrompterNode(node("required"), {}, runtime),
		).rejects.toBeInstanceOf(FlowNodeError);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.output).toBeDefined();
	});

	it("required: returns validated structured output", async () => {
		structuredBehavior = "ok";
		const result = await runLlmPrompterNode(node("required"), {}, runtime);
		expect(result.object).toEqual({ items: [] });
		expect(result.detail.mode).toBe("structured");
	});

	it("preferred (default): still falls back to free-form", async () => {
		structuredBehavior = "throw";
		const result = await runLlmPrompterNode(node(), {}, runtime);
		expect(calls).toHaveLength(2);
		expect(result.detail.mode).toBe("freeform");
	});
});
