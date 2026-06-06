import { describe, expect, it, vi } from "vitest";

vi.mock("@toby/core/huggingface/downloadedmodels", () => ({
	getDownloadedModels: vi.fn(() => [
		"Qwen/Qwen3-0.6B",
		"ibm-granite/granite-3.3-2b-instruct",
	]),
	getInferenceModels: vi.fn(() => ["meta-llama/Llama-3.2-3B-Instruct"]),
}));

import { getAIProviders } from "@toby/core/ai/providers";

describe("getAIProviders", () => {
	it("includes Hugging Face self-hosted models from downloaded model registry", () => {
		const providers = getAIProviders();
		const selfHosted = providers.find(
			(p) => p.id === "huggingface-self-hosted",
		);

		expect(selfHosted).toBeDefined();
		expect(selfHosted?.displayName).toBe("Hugging Face Self Hosted");
		expect(selfHosted?.models).toEqual([
			"Qwen/Qwen3-0.6B",
			"ibm-granite/granite-3.3-2b-instruct",
		]);
	});

	it("includes Hugging Face Inference models from config", () => {
		const providers = getAIProviders();
		const inference = providers.find((p) => p.id === "huggingface-inference");

		expect(inference).toBeDefined();
		expect(inference?.displayName).toBe("Hugging Face Inference");
		expect(inference?.models).toEqual(["meta-llama/Llama-3.2-3B-Instruct"]);
	});

	it("retains the expected OpenAI model list", () => {
		const providers = getAIProviders();
		const openai = providers.find((p) => p.id === "openai");

		expect(openai).toBeDefined();
		expect(openai?.models).toContain("gpt-5-mini");
		expect(openai?.models).toContain("o4-mini");
	});
});
