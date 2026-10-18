import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	createEmbeddingModelForPersona,
	resolveEmbedModelId,
} from "@toby/core/ai/embeddings";
import type { Persona } from "@toby/core/config/index";

function persona(provider: string): Persona {
	return {
		name: "Test",
		instructions: "",
		promptMode: "add",
		ai: { provider, model: "openai/gpt-5.6-luna" },
	};
}

describe("embedding models", () => {
	const previousKey = process.env.OPENROUTER_API_KEY;
	const previousTobyDir = process.env.TOBY_DIR;
	const previousEmbedModel = process.env.TOBY_ROUTING_EMBED_MODEL;
	let tempDir: string;

	afterEach(() => {
		if (previousKey === undefined) {
			Reflect.deleteProperty(process.env, "OPENROUTER_API_KEY");
		} else {
			process.env.OPENROUTER_API_KEY = previousKey;
		}
		if (previousTobyDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previousTobyDir;
		}
		if (previousEmbedModel === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_ROUTING_EMBED_MODEL");
		} else {
			process.env.TOBY_ROUTING_EMBED_MODEL = previousEmbedModel;
		}
		if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("uses an OpenRouter embedding model when a key is set", () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-embed-model-"));
		process.env.TOBY_DIR = tempDir;
		Reflect.deleteProperty(process.env, "TOBY_ROUTING_EMBED_MODEL");
		Reflect.deleteProperty(process.env, "OPENROUTER_API_KEY");
		expect(createEmbeddingModelForPersona(persona("openrouter"))).toBeNull();
		expect(resolveEmbedModelId(persona("openrouter"))).toBe(
			"openai/text-embedding-3-small",
		);

		process.env.OPENROUTER_API_KEY = "test-key";
		const model = createEmbeddingModelForPersona(persona("openrouter"));
		expect(model).not.toBeNull();
		expect(model?.modelId).toBe("openai/text-embedding-3-small");
	});

	it("prefixes a bare OpenRouter embedding override", () => {
		process.env.TOBY_ROUTING_EMBED_MODEL = "text-embedding-3-large";
		expect(resolveEmbedModelId(persona("openrouter"))).toBe(
			"openai/text-embedding-3-large",
		);
	});
});
