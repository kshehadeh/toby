import crypto from "node:crypto";
import type {
	LanguageModelV3CallOptions,
	LanguageModelV3GenerateResult,
	LanguageModelV3StreamPart,
	SharedV3ProviderOptions,
} from "@ai-sdk/provider";

export const RECORDING_FORMAT_VERSION = 1;

const DATETIME_BLOCK_RE =
	/\n\n<!-- TOBY_DATETIME_START -->[\s\S]*?<!-- TOBY_DATETIME_END -->/g;

const DATETIME_STANDALONE_RE =
	/^<!-- TOBY_DATETIME_START -->[\s\S]*?<!-- TOBY_DATETIME_END -->$/;

export type RecordedGenerateResult = Pick<
	LanguageModelV3GenerateResult,
	"content" | "finishReason" | "usage" | "warnings" | "providerMetadata"
>;

export type RecordedModelCall =
	| {
			readonly op: "generate";
			readonly paramsDigest: string;
			readonly result: RecordedGenerateResult;
	  }
	| {
			readonly op: "stream";
			readonly paramsDigest: string;
			readonly chunks: readonly LanguageModelV3StreamPart[];
	  };

export type SessionRecording = {
	readonly version: typeof RECORDING_FORMAT_VERSION;
	readonly createdAt: string;
	readonly persona: {
		readonly provider: string;
		readonly model: string;
	};
	entries: RecordedModelCall[];
};

type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { readonly [key: string]: JsonValue };

function sha256Digest(input: string): string {
	return crypto.createHash("sha256").update(input).digest("hex");
}

function stripDatetimeFromSystemContent(content: string): string {
	return content.replace(DATETIME_BLOCK_RE, "");
}

function normalizePromptContent(
	content: LanguageModelV3CallOptions["prompt"][number]["content"],
): LanguageModelV3CallOptions["prompt"][number]["content"] {
	if (typeof content === "string") {
		return stripDatetimeFromSystemContent(content);
	}
	return content.map((part) => {
		if (part.type === "text" && "text" in part) {
			return {
				...part,
				text: stripDatetimeFromSystemContent(part.text),
			};
		}
		return part;
	}) as LanguageModelV3CallOptions["prompt"][number]["content"];
}

function normalizeProviderOptions(
	options: SharedV3ProviderOptions | undefined,
): SharedV3ProviderOptions | undefined {
	if (!options) {
		return undefined;
	}
	const normalized: SharedV3ProviderOptions = {};
	if (options.openai) {
		const { promptCacheKey: _promptCacheKey, ...openaiRest } =
			options.openai as Record<string, unknown>;
		if (Object.keys(openaiRest).length > 0) {
			normalized.openai = openaiRest as NonNullable<
				SharedV3ProviderOptions["openai"]
			>;
		}
	}
	if (options.gateway) {
		const { caching: _caching, ...gatewayRest } = options.gateway as Record<
			string,
			unknown
		>;
		if (Object.keys(gatewayRest).length > 0) {
			normalized.gateway = gatewayRest as NonNullable<
				SharedV3ProviderOptions["gateway"]
			>;
		}
	}
	for (const [key, value] of Object.entries(options)) {
		if (key === "openai" || key === "gateway") {
			continue;
		}
		(normalized as Record<string, unknown>)[key] = value;
	}
	return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/** Stable subset of model call params for digesting and matching. */
export function normalizeCallParams(
	params: LanguageModelV3CallOptions,
): Record<string, unknown> {
	return {
		prompt: params.prompt
			.filter((message) => {
				// Drop standalone datetime system messages for digest stability.
				if (
					message.role === "system" &&
					typeof message.content === "string" &&
					DATETIME_STANDALONE_RE.test(message.content.trim())
				) {
					return false;
				}
				return true;
			})
			.map((message) => ({
				role: message.role,
				content:
					message.role === "system"
						? normalizePromptContent(message.content)
						: message.content,
				...(message.providerOptions
					? { providerOptions: message.providerOptions }
					: {}),
			})),
		maxOutputTokens: params.maxOutputTokens,
		temperature: params.temperature,
		stopSequences: params.stopSequences,
		topP: params.topP,
		topK: params.topK,
		presencePenalty: params.presencePenalty,
		frequencyPenalty: params.frequencyPenalty,
		responseFormat: params.responseFormat,
		seed: params.seed,
		tools: params.tools,
		toolChoice: params.toolChoice,
		providerOptions: normalizeProviderOptions(params.providerOptions),
	};
}

export function computeParamsDigest(
	params: LanguageModelV3CallOptions,
): string {
	return sha256Digest(JSON.stringify(normalizeCallParams(params)));
}

export function serializeGenerateResult(
	result: LanguageModelV3GenerateResult,
): RecordedGenerateResult {
	return {
		content: result.content,
		finishReason: result.finishReason,
		usage: result.usage,
		warnings: result.warnings,
		...(result.providerMetadata
			? { providerMetadata: result.providerMetadata }
			: {}),
	};
}

function isUint8Array(value: unknown): value is Uint8Array {
	return value instanceof Uint8Array;
}

function reviveBinary(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(reviveBinary);
	}
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		if (
			record.__tobyBinary === "Uint8Array" &&
			typeof record.data === "string"
		) {
			return Buffer.from(record.data, "base64");
		}
		const out: Record<string, unknown> = {};
		for (const [key, nested] of Object.entries(record)) {
			out[key] = reviveBinary(nested);
		}
		return out;
	}
	return value;
}

function encodeBinary(value: unknown): JsonValue {
	if (isUint8Array(value)) {
		return {
			__tobyBinary: "Uint8Array",
			data: Buffer.from(value).toString("base64"),
		};
	}
	if (Array.isArray(value)) {
		return value.map((item) => encodeBinary(item)) as JsonValue[];
	}
	if (value && typeof value === "object") {
		const out: Record<string, JsonValue> = {};
		for (const [key, nested] of Object.entries(value)) {
			out[key] = encodeBinary(nested) as JsonValue;
		}
		return out;
	}
	return value as JsonValue;
}

export function serializeRecording(recording: SessionRecording): string {
	return `${JSON.stringify(encodeBinary(recording), null, 2)}\n`;
}

export function parseRecording(raw: string): SessionRecording {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new Error(
			`Invalid recording file: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const revived = reviveBinary(parsed) as SessionRecording;
	if (
		!revived ||
		typeof revived !== "object" ||
		revived.version !== RECORDING_FORMAT_VERSION ||
		!Array.isArray(revived.entries)
	) {
		throw new Error(
			`Unsupported recording format (expected version ${RECORDING_FORMAT_VERSION}).`,
		);
	}
	return revived;
}

export function toGenerateResult(
	recorded: RecordedGenerateResult,
): LanguageModelV3GenerateResult {
	return {
		...recorded,
		warnings: [...recorded.warnings],
		content: [...recorded.content],
	};
}

export function toStreamChunks(
	chunks: readonly LanguageModelV3StreamPart[],
): LanguageModelV3StreamPart[] {
	return chunks.map((chunk) => structuredClone(chunk));
}
