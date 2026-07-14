import type {
	LanguageModelV4,
	LanguageModelV4CallOptions,
} from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import type { Persona } from "../../config/index";
import { toGenerateResult, toStreamChunks } from "./recording-format";
import { getReplayStore } from "./session";

class ReplayLanguageModel implements LanguageModelV4 {
	readonly specificationVersion = "v4";
	readonly provider: string;
	readonly modelId: string;
	readonly supportedUrls: Record<string, RegExp[]> = {};

	constructor(persona: Persona) {
		this.provider = persona.ai.provider;
		this.modelId = persona.ai.model;
	}

	doGenerate(options: LanguageModelV4CallOptions) {
		const store = getReplayStore();
		const entry = store.take("generate", options);
		if (entry.op !== "generate") {
			throw new Error(
				`Expected recorded generate response at cursor, got ${entry.op}.`,
			);
		}
		return Promise.resolve(toGenerateResult(entry.result));
	}

	doStream(options: LanguageModelV4CallOptions) {
		const store = getReplayStore();
		const entry = store.take("stream", options);
		if (entry.op !== "stream") {
			throw new Error(
				`Expected recorded stream response at cursor, got ${entry.op}.`,
			);
		}
		return Promise.resolve({
			stream: simulateReadableStream({
				chunks: toStreamChunks(entry.chunks),
				initialDelayInMs: null,
				chunkDelayInMs: null,
			}),
		});
	}
}

export function createReplayModel(persona: Persona): LanguageModelV4 {
	return new ReplayLanguageModel(persona);
}
