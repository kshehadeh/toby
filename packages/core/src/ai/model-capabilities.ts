import type { Persona } from "../config/index";

export const CHAT_ATTACHMENT_MAX_FILES = 5;
export const CHAT_ATTACHMENT_MAX_BYTES_PER_FILE = 20 * 1024 * 1024;
export const CHAT_ATTACHMENT_MAX_TOTAL_BYTES = 50 * 1024 * 1024;

export const CHAT_ATTACHMENT_ACCEPTED_MEDIA_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
	"application/pdf",
	"text/plain",
	"text/markdown",
	"text/csv",
	"application/json",
	"application/xml",
	"text/xml",
	"text/html",
	"text/css",
	"text/javascript",
	"application/javascript",
	"application/typescript",
	"application/rtf",
	"application/msword",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.ms-excel",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.ms-powerpoint",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;

export type ChatAttachmentCapability = {
	readonly supported: boolean;
	readonly reason?: string;
	readonly acceptedMediaTypes: readonly string[];
	readonly maxFiles: number;
	readonly maxBytesPerFile: number;
	readonly maxTotalBytes: number;
};

const ACCEPTED_MEDIA_TYPE_SET = new Set<string>(
	CHAT_ATTACHMENT_ACCEPTED_MEDIA_TYPES,
);

function baseCapability(
	supported: boolean,
	reason?: string,
): ChatAttachmentCapability {
	return {
		supported,
		...(reason ? { reason } : {}),
		acceptedMediaTypes: CHAT_ATTACHMENT_ACCEPTED_MEDIA_TYPES,
		maxFiles: CHAT_ATTACHMENT_MAX_FILES,
		maxBytesPerFile: CHAT_ATTACHMENT_MAX_BYTES_PER_FILE,
		maxTotalBytes: CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
	};
}

function openAiModelSupportsAttachments(model: string): boolean {
	const id = model.trim().toLowerCase();
	return (
		id.startsWith("gpt-5") ||
		id.startsWith("gpt-4.1") ||
		id.startsWith("gpt-4o") ||
		id === "o3" ||
		id === "o4-mini"
	);
}

function gatewayModelSupportsAttachments(model: string): boolean {
	const id = model.trim().toLowerCase();
	if (id.startsWith("openai/")) {
		return openAiModelSupportsAttachments(id.slice("openai/".length));
	}
	return id.startsWith("anthropic/claude-") || id.startsWith("google/gemini-");
}

export function resolveChatAttachmentCapability(
	persona: Persona,
): ChatAttachmentCapability {
	switch (persona.ai.provider) {
		case "openai":
			return openAiModelSupportsAttachments(persona.ai.model)
				? baseCapability(true)
				: baseCapability(
						false,
						`Model ${persona.ai.model} is not configured as supporting file attachments.`,
					);
		case "vercel":
			return gatewayModelSupportsAttachments(persona.ai.model)
				? baseCapability(true)
				: baseCapability(
						false,
						`Gateway model ${persona.ai.model} is not configured as supporting file attachments.`,
					);
		case "ollama":
			return baseCapability(
				false,
				"Ollama attachment support varies by local model and is disabled by default.",
			);
		default:
			return baseCapability(
				false,
				`Provider ${persona.ai.provider} is not configured as supporting file attachments.`,
			);
	}
}

export function isAcceptedChatAttachmentMediaType(mediaType: string): boolean {
	return ACCEPTED_MEDIA_TYPE_SET.has(mediaType.trim().toLowerCase());
}
