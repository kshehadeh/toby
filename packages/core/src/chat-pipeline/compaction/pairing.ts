import type { CoreMessage } from "../../ai/chat";

export type ToolPairRef = {
	readonly toolCallId: string;
	readonly toolName: string;
	/** Index of the message that holds the tool-result part. */
	readonly resultMessageIndex: number;
	/** Index within that message's content array. */
	readonly resultPartIndex: number;
	/** True when this result is already a cleared placeholder. */
	readonly alreadyCleared: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isToolResultPart(part: unknown): part is {
	type: "tool-result";
	toolCallId: string;
	toolName: string;
	output?: unknown;
	result?: unknown;
} {
	if (!isRecord(part) || part.type !== "tool-result") return false;
	return (
		typeof part.toolCallId === "string" && typeof part.toolName === "string"
	);
}

export function isToolCallPart(part: unknown): part is {
	type: "tool-call";
	toolCallId: string;
	toolName: string;
	input?: unknown;
	args?: unknown;
} {
	if (!isRecord(part) || part.type !== "tool-call") return false;
	return (
		typeof part.toolCallId === "string" && typeof part.toolName === "string"
	);
}

export function getToolResultPayload(part: {
	output?: unknown;
	result?: unknown;
}): unknown {
	return part.output ?? part.result;
}

export function isClearedToolResult(
	part: {
		output?: unknown;
		result?: unknown;
	},
	placeholder: string,
): boolean {
	const payload = getToolResultPayload(part);
	const markers = [
		placeholder,
		"[tool result cleared",
		"[superseded tool result",
	];
	const matchesMarker = (text: string) =>
		markers.some((m) => text === m || text.includes(m));

	if (typeof payload === "string") {
		return matchesMarker(payload);
	}
	if (isRecord(payload)) {
		if (payload.type === "text" && typeof payload.value === "string") {
			return matchesMarker(payload.value);
		}
		if (payload.type === "json" && isRecord(payload.value)) {
			return (
				payload.value._cleared === true || payload.value._superseded === true
			);
		}
	}
	return false;
}

/**
 * Collect tool-result parts in chronological order (oldest first).
 * Pairing is by toolCallId; we do not require the call to still exist in-history
 * (legacy rows) but callers must keep result messages intact when blanking.
 */
export function collectToolResultPairs(
	messages: readonly CoreMessage[],
	placeholder: string,
): ToolPairRef[] {
	const pairs: ToolPairRef[] = [];
	for (let mi = 0; mi < messages.length; mi++) {
		const message = messages[mi];
		if (!message) continue;
		if (message.role !== "tool" && message.role !== "assistant") continue;
		const content = message.content;
		if (!Array.isArray(content)) continue;
		for (let pi = 0; pi < content.length; pi++) {
			const part = content[pi];
			if (!isToolResultPart(part)) continue;
			pairs.push({
				toolCallId: part.toolCallId,
				toolName: part.toolName,
				resultMessageIndex: mi,
				resultPartIndex: pi,
				alreadyCleared: isClearedToolResult(part, placeholder),
			});
		}
	}
	return pairs;
}

/** Count unpaired tool-call ids (calls without results or results without calls). */
export function countOrphanToolParts(messages: readonly CoreMessage[]): number {
	const calls = new Set<string>();
	const results = new Set<string>();
	for (const message of messages) {
		if (message.role !== "tool" && message.role !== "assistant") continue;
		const content = message.content;
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			if (isToolCallPart(part)) calls.add(part.toolCallId);
			if (isToolResultPart(part)) results.add(part.toolCallId);
		}
	}
	let orphans = 0;
	for (const id of calls) {
		if (!results.has(id)) orphans += 1;
	}
	for (const id of results) {
		if (!calls.has(id)) orphans += 1;
	}
	return orphans;
}
