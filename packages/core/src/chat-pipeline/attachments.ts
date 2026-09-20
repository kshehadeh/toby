import type { FilePart, ModelMessage } from "ai";
import {
	CHAT_ATTACHMENT_MAX_BYTES_PER_FILE,
	CHAT_ATTACHMENT_MAX_FILES,
	CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
	CHAT_INLINE_TEXT_MAX_CHARS,
	isAcceptedChatAttachmentMediaType,
	isExtractableChatAttachmentMediaType,
	isInlineTextChatAttachmentMediaType,
	isNativeChatFilePartMediaType,
	normalizeChatAttachmentMediaType,
	resolveChatAttachmentCapability,
} from "../ai/model-capabilities";
import type { Persona } from "../config/index";
import type { TranscriptAttachment } from "./transcript-types";

export type ChatAttachment = {
	readonly filename: string;
	readonly mediaType: string;
	readonly dataBase64: string;
	readonly byteSize: number;
};

export type ValidatedChatAttachment = ChatAttachment & {
	readonly mediaType: string;
	readonly byteSize: number;
};

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

function isValidBase64(input: string): boolean {
	if (input.length === 0 || input.length % 4 !== 0) {
		return false;
	}
	return BASE64_RE.test(input);
}

function decodedBase64Size(input: string): number {
	const padding = input.endsWith("==") ? 2 : input.endsWith("=") ? 1 : 0;
	return (input.length / 4) * 3 - padding;
}

export function validateChatAttachments(
	attachments: readonly ChatAttachment[] | undefined,
	persona: Persona,
	options: {
		readonly allowUnsupportedModel?: boolean;
		readonly allowAnyMediaType?: boolean;
	} = {},
): readonly ValidatedChatAttachment[] {
	if (!attachments || attachments.length === 0) {
		return [];
	}

	const capability = resolveChatAttachmentCapability(persona);
	const extractableOnly =
		!capability.supported &&
		!options.allowUnsupportedModel &&
		attachments.every((attachment) =>
			isExtractableChatAttachmentMediaType(attachment.mediaType ?? ""),
		);
	if (
		!capability.supported &&
		!options.allowUnsupportedModel &&
		!extractableOnly
	) {
		throw new Error(
			capability.reason ?? "The selected model does not support attachments.",
		);
	}

	if (attachments.length > CHAT_ATTACHMENT_MAX_FILES) {
		throw new Error(
			`Too many attachments. Maximum is ${CHAT_ATTACHMENT_MAX_FILES}.`,
		);
	}

	let totalBytes = 0;
	return attachments.map((attachment, index) => {
		const filename = attachment.filename?.trim();
		if (!filename) {
			throw new Error(`Attachment ${index + 1} is missing a filename.`);
		}
		if (filename.includes("/") || filename.includes("\\")) {
			throw new Error(
				`Attachment "${filename}" must not include path separators.`,
			);
		}

		const mediaType = normalizeChatAttachmentMediaType(
			attachment.mediaType ?? "",
		);
		if (
			!options.allowAnyMediaType &&
			!isAcceptedChatAttachmentMediaType(mediaType)
		) {
			throw new Error(
				`Unsupported attachment type: ${mediaType || "(missing)"}.`,
			);
		}

		const byteSize = Number(attachment.byteSize);
		if (!Number.isSafeInteger(byteSize) || byteSize <= 0) {
			throw new Error(`Attachment "${filename}" has an invalid size.`);
		}
		if (byteSize > CHAT_ATTACHMENT_MAX_BYTES_PER_FILE) {
			throw new Error(
				`Attachment "${filename}" is too large. Maximum is ${CHAT_ATTACHMENT_MAX_BYTES_PER_FILE} bytes.`,
			);
		}

		const dataBase64 = attachment.dataBase64 ?? "";
		if (!isValidBase64(dataBase64)) {
			throw new Error(`Attachment "${filename}" is not valid base64.`);
		}
		const decodedSize = decodedBase64Size(dataBase64);
		if (decodedSize !== byteSize) {
			throw new Error(
				`Attachment "${filename}" size does not match its decoded data.`,
			);
		}

		totalBytes += byteSize;
		if (totalBytes > CHAT_ATTACHMENT_MAX_TOTAL_BYTES) {
			throw new Error(
				`Attachments are too large. Maximum total is ${CHAT_ATTACHMENT_MAX_TOTAL_BYTES} bytes.`,
			);
		}

		return {
			filename,
			mediaType,
			dataBase64,
			byteSize,
		};
	});
}

export function chatAttachmentsToFileParts(
	attachments: readonly ValidatedChatAttachment[] | undefined,
): FilePart[] {
	return (attachments ?? [])
		.filter((attachment) => isNativeChatFilePartMediaType(attachment.mediaType))
		.map((attachment) => ({
			type: "file",
			filename: attachment.filename,
			mediaType: attachment.mediaType,
			data: attachment.dataBase64,
		}));
}

export function formatInlineTextAttachments(
	attachments: readonly ValidatedChatAttachment[] | undefined,
): string {
	if (!attachments || attachments.length === 0) {
		return "";
	}
	const blocks: string[] = [];
	for (const attachment of attachments) {
		if (!isInlineTextChatAttachmentMediaType(attachment.mediaType)) {
			continue;
		}
		let decoded = Buffer.from(attachment.dataBase64, "base64").toString("utf8");
		let truncated = false;
		if (decoded.length > CHAT_INLINE_TEXT_MAX_CHARS) {
			decoded = decoded.slice(0, CHAT_INLINE_TEXT_MAX_CHARS);
			truncated = true;
		}
		const header = `Attached file: ${attachment.filename} (${attachment.mediaType})`;
		const notice = truncated
			? `\n[Truncated to ${CHAT_INLINE_TEXT_MAX_CHARS} characters.]`
			: "";
		blocks.push(
			`${header}\n----- begin ${attachment.filename} -----\n${decoded}\n----- end ${attachment.filename} -----${notice}`,
		);
	}
	if (blocks.length === 0) {
		return "";
	}
	return `\n\n${blocks.join("\n\n")}`;
}

export function formatAttachmentTranscriptSummary(
	attachments: readonly ValidatedChatAttachment[] | undefined,
): string {
	if (!attachments || attachments.length === 0) {
		return "";
	}
	const labels = attachments.map(
		(a) => `${a.filename} (${a.mediaType}, ${a.byteSize} bytes)`,
	);
	return `\n\nAttachments: ${labels.join(", ")}`;
}

export function chatAttachmentsToTranscriptAttachments(
	attachments: readonly ValidatedChatAttachment[] | undefined,
): TranscriptAttachment[] {
	return (attachments ?? [])
		.filter((attachment) => attachment.mediaType.startsWith("image/"))
		.map((attachment) => ({
			filename: attachment.filename,
			mediaType: attachment.mediaType,
			dataBase64: attachment.dataBase64,
			byteSize: attachment.byteSize,
		}));
}

function decodeFilePartUtf8(part: FilePart): string | null {
	const data = part.data;
	if (typeof data === "string") {
		try {
			return Buffer.from(data, "base64").toString("utf8");
		} catch {
			return data;
		}
	}
	if (data instanceof Uint8Array) {
		return Buffer.from(data).toString("utf8");
	}
	return null;
}

function inlineFilePartAsText(
	part: FilePart,
	mediaType: string,
): {
	type: "text";
	text: string;
} | null {
	const decoded = decodeFilePartUtf8(part);
	if (decoded === null) {
		return null;
	}
	let text = decoded;
	let truncated = false;
	if (text.length > CHAT_INLINE_TEXT_MAX_CHARS) {
		text = text.slice(0, CHAT_INLINE_TEXT_MAX_CHARS);
		truncated = true;
	}
	const filename =
		typeof part.filename === "string" && part.filename.trim().length > 0
			? part.filename.trim()
			: "attachment";
	const notice = truncated
		? `\n[Truncated to ${CHAT_INLINE_TEXT_MAX_CHARS} characters.]`
		: "";
	return {
		type: "text",
		text: `Attached file: ${filename} (${mediaType})\n----- begin ${filename} -----\n${text}\n----- end ${filename} -----${notice}`,
	};
}

/**
 * Providers only accept images and PDFs as native file parts. Convert
 * text-like leftovers to message text and drop Office/binary file parts so
 * `streamText` cannot fail with "file part media type … not supported".
 */
export function sanitizeModelMessagesForProvider(
	messages: readonly ModelMessage[],
): ModelMessage[] {
	return messages.map((message) => {
		if (!Array.isArray(message.content)) {
			return message;
		}
		const nextContent: typeof message.content = [];
		for (const part of message.content) {
			if (
				!part ||
				typeof part !== "object" ||
				!("type" in part) ||
				part.type !== "file"
			) {
				nextContent.push(part);
				continue;
			}
			const mediaType = normalizeChatAttachmentMediaType(
				typeof part.mediaType === "string" ? part.mediaType : "",
			);
			if (isNativeChatFilePartMediaType(mediaType)) {
				nextContent.push({ ...part, mediaType });
				continue;
			}
			if (isInlineTextChatAttachmentMediaType(mediaType)) {
				const textPart = inlineFilePartAsText(part, mediaType);
				if (textPart) {
					nextContent.push(textPart);
				}
			}
		}
		if (nextContent.length === 0) {
			return { ...message, content: "" } as ModelMessage;
		}
		if (
			nextContent.length === 1 &&
			nextContent[0] &&
			typeof nextContent[0] === "object" &&
			"type" in nextContent[0] &&
			nextContent[0].type === "text" &&
			"text" in nextContent[0] &&
			typeof nextContent[0].text === "string"
		) {
			return { ...message, content: nextContent[0].text } as ModelMessage;
		}
		return { ...message, content: nextContent } as ModelMessage;
	});
}
