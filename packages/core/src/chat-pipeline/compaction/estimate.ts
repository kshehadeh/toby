import type { CoreMessage } from "../../ai/chat";

/**
 * Rough token estimate (~4 characters per token), matching common heuristics
 * used when a provider-specific tokenizer is unavailable.
 */
export function estimateTextTokens(text: string): number {
	if (!text) return 0;
	return Math.ceil(text.length / 4);
}

function estimateUnknown(value: unknown): number {
	if (value == null) return 0;
	if (typeof value === "string") return estimateTextTokens(value);
	if (typeof value === "number" || typeof value === "boolean") {
		return estimateTextTokens(String(value));
	}
	try {
		return estimateTextTokens(JSON.stringify(value));
	} catch {
		return estimateTextTokens(String(value));
	}
}

function estimatePart(part: unknown): number {
	if (part == null) return 0;
	if (typeof part === "string") return estimateTextTokens(part);
	if (typeof part !== "object") return estimateUnknown(part);

	const rec = part as Record<string, unknown>;
	const type = rec.type;

	if (type === "text" && typeof rec.text === "string") {
		return estimateTextTokens(rec.text);
	}
	if (type === "reasoning" && typeof rec.text === "string") {
		return estimateTextTokens(rec.text);
	}
	if (type === "tool-call") {
		return (
			estimateTextTokens(String(rec.toolName ?? "")) +
			estimateUnknown(rec.input ?? rec.args)
		);
	}
	if (type === "tool-result") {
		return (
			estimateTextTokens(String(rec.toolName ?? "")) +
			estimateUnknown(rec.output ?? rec.result)
		);
	}
	if (type === "file" || type === "image") {
		// Binary payloads should already be summarized at persist time; count a stub.
		return 64;
	}
	return estimateUnknown(part);
}

/** Estimate tokens for a single message (role + content). */
export function estimateMessageTokens(message: CoreMessage): number {
	const roleCost = 4;
	const content = message.content;
	if (typeof content === "string") {
		return roleCost + estimateTextTokens(content);
	}
	if (Array.isArray(content)) {
		let total = roleCost;
		for (const part of content) {
			total += estimatePart(part);
		}
		return total;
	}
	return roleCost + estimateUnknown(content);
}

/** Estimate total tokens for a message list. */
export function estimateMessagesTokens(
	messages: readonly CoreMessage[],
): number {
	let total = 0;
	for (const m of messages) {
		total += estimateMessageTokens(m);
	}
	return total;
}
