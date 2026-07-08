import type { FilePart } from "ai";
import {
	CHAT_ATTACHMENT_MAX_BYTES_PER_FILE,
	CHAT_ATTACHMENT_MAX_FILES,
	CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
	isAcceptedChatAttachmentMediaType,
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
): readonly ValidatedChatAttachment[] {
	if (!attachments || attachments.length === 0) {
		return [];
	}

	const capability = resolveChatAttachmentCapability(persona);
	if (!capability.supported) {
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

		const mediaType = attachment.mediaType?.trim().toLowerCase();
		if (!isAcceptedChatAttachmentMediaType(mediaType)) {
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
	return (attachments ?? []).map((attachment) => ({
		type: "file",
		filename: attachment.filename,
		mediaType: attachment.mediaType,
		data: attachment.dataBase64,
	}));
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
