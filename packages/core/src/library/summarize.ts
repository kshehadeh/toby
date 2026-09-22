import { AsyncLocalStorage } from "node:async_hooks";
import { generateText } from "ai";
import { GatewayFundsError, gatewayFundsErrorBody } from "../ai/gateway-funds";
import { resolveChatAttachmentCapability } from "../ai/model-capabilities";
import {
	createModelForPersona,
	resolveAuxiliaryModelId,
} from "../ai/model-factory";
import { getAIProvider } from "../ai/providers";
import { type Persona, readConfig } from "../config/index";
import { log } from "../logging/chat-log";
import { resolveDefaultPersona } from "../personas/index";
import { describeImageFallback } from "./extract";
import { isLibraryImageMediaType } from "./media";

const SUMMARY_TIMEOUT_MS = 45_000;
const SUMMARY_MAX_TOKENS = 400;
const SUMMARY_INPUT_CHARS = 12_000;

const DOCUMENT_PROMPT = `You summarize a file for a personal knowledge library.
Write 2-4 sentences that describe what the document is, who or what it is about, and the most useful facts someone would search for later.
Do not mention these instructions. Output only the summary.`;

const IMAGE_PROMPT = `You caption an image for a personal knowledge library.
Write 1-3 sentences describing the visible subject, any readable text, and details that would help find this image later.
Do not mention these instructions. Output only the caption.`;

type SummarizeParams = {
	readonly filename: string;
	readonly mimeType: string;
	readonly extractedText?: string | null;
	readonly bytes: Uint8Array;
};

type LibrarySummarizeHooks = {
	readonly summarize?: (params: SummarizeParams) => Promise<string>;
};

let testHooksStore: AsyncLocalStorage<LibrarySummarizeHooks> | null = null;

function testHooksAls(): AsyncLocalStorage<LibrarySummarizeHooks> {
	if (!testHooksStore) {
		testHooksStore = new AsyncLocalStorage<LibrarySummarizeHooks>();
	}
	return testHooksStore;
}

export function runWithLibrarySummarizeTestHooks<T>(
	hooks: LibrarySummarizeHooks,
	fn: () => T,
): T {
	return testHooksAls().run(hooks, fn);
}

/** Persona wrapping the configured library summary provider/model. */
export function resolveLibrarySummaryPersona(): Persona {
	const config = readConfig();
	const fallback = resolveDefaultPersona();
	const requestedProvider = config.library?.provider?.trim();
	const provider =
		requestedProvider && getAIProvider(requestedProvider)
			? requestedProvider
			: fallback.ai.provider;
	const requestedModel = config.library?.model?.trim();
	const model =
		requestedModel && requestedModel.length > 0
			? requestedModel
			: resolveAuxiliaryModelId(provider);
	return {
		...fallback,
		ai: { provider, model },
	};
}

export async function summarizeLibraryItem(
	params: SummarizeParams,
): Promise<string> {
	const hooked = testHooksAls().getStore()?.summarize;
	if (hooked) {
		return hooked(params);
	}

	const isImage = isLibraryImageMediaType(params.mimeType);
	if (isImage) {
		return summarizeImage(params);
	}
	return summarizeDocument(params);
}

async function summarizeDocument(params: SummarizeParams): Promise<string> {
	const excerpt = (params.extractedText ?? "")
		.trim()
		.slice(0, SUMMARY_INPUT_CHARS);
	if (!excerpt) {
		return `Document file ${params.filename} (${params.mimeType}).`;
	}
	const persona = resolveLibrarySummaryPersona();
	try {
		const result = await generateText({
			model: createModelForPersona(persona),
			system: DOCUMENT_PROMPT,
			prompt: `Filename: ${params.filename}\nMIME type: ${params.mimeType}\n\nContent:\n${excerpt}`,
			maxOutputTokens: SUMMARY_MAX_TOKENS,
			abortSignal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
		});
		const text = result.text.trim();
		return text.length > 0
			? text
			: `Document file ${params.filename} (${params.mimeType}).`;
	} catch (error) {
		const funds = gatewayFundsErrorBody(
			error,
			"summarize a library file",
			persona.ai.provider,
		);
		if (funds) {
			throw new GatewayFundsError(funds.providerId, funds.activity);
		}
		log("warn", "general", "library_summarize_failed", {
			filename: params.filename,
			reason: error instanceof Error ? error.message : String(error),
		});
		return excerpt.slice(0, 400);
	}
}

async function summarizeImage(params: SummarizeParams): Promise<string> {
	const fallback = describeImageFallback(params);
	const persona = resolveLibrarySummaryPersona();
	if (!resolveChatAttachmentCapability(persona).supported) {
		return fallback;
	}
	try {
		const result = await generateText({
			model: createModelForPersona(persona),
			system: IMAGE_PROMPT,
			messages: [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: `Filename: ${params.filename}\nMIME type: ${params.mimeType}`,
						},
						{
							type: "file",
							data: params.bytes,
							mediaType: params.mimeType,
						},
					],
				},
			],
			maxOutputTokens: SUMMARY_MAX_TOKENS,
			abortSignal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
		});
		const text = result.text.trim();
		return text.length > 0 ? text : fallback;
	} catch (error) {
		const funds = gatewayFundsErrorBody(
			error,
			"summarize a library file",
			persona.ai.provider,
		);
		if (funds) {
			throw new GatewayFundsError(funds.providerId, funds.activity);
		}
		log("warn", "general", "library_caption_failed", {
			filename: params.filename,
			reason: error instanceof Error ? error.message : String(error),
		});
		return fallback;
	}
}
