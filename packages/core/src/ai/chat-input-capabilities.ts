import { readConfig } from "../config/index";
import type { Persona } from "../config/index";
import {
	CHAT_EXTRACTABLE_ATTACHMENT_MEDIA_TYPES,
	normalizeChatAttachmentMediaType,
	resolveChatAttachmentCapability,
} from "./model-capabilities";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Local tools can process an image even when the language model cannot see it. */
export function canProcessImageAttachment(mediaType: string): boolean {
	return (
		Boolean(readConfig().integrations.images?.connectedAt) &&
		IMAGE_TYPES.includes(normalizeChatAttachmentMediaType(mediaType))
	);
}

export function resolveChatInputCapability(persona: Persona) {
	const capability = resolveChatAttachmentCapability(persona);
	if (capability.supported || !readConfig().integrations.images?.connectedAt)
		return capability;
	return {
		...capability,
		supported: true,
		reason:
			"Images are available to local tools; this model cannot inspect image content.",
		acceptedMediaTypes: [
			...IMAGE_TYPES,
			...CHAT_EXTRACTABLE_ATTACHMENT_MEDIA_TYPES,
		],
	};
}
