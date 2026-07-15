import type { CoreMessage } from "../../ai/chat";
import { estimateTextTokens } from "./estimate";
import { isToolCallPart } from "./pairing";

export type ClampOptions = {
	readonly maxPartTokens: number;
	readonly keepHeadChars: number;
	readonly keepTailChars: number;
	/** When true, also clamp oversized tool-call args. Default true. */
	readonly clampToolCallArgs?: boolean;
};

export type ClampResult = {
	readonly messages: CoreMessage[];
	readonly clampedParts: number;
	readonly changed: boolean;
};

function headTailClamp(text: string, head: number, tail: number): string {
	if (text.length <= head + tail) return text;
	const removed = text.length - head - tail;
	return `${text.slice(0, head)}\n[clamped: removed ${removed} of ${text.length} characters]\n${text.slice(-tail)}`;
}

function clampStringIfNeeded(
	text: string,
	opts: ClampOptions,
): { text: string; clamped: boolean } {
	const tokens = estimateTextTokens(text);
	if (tokens <= opts.maxPartTokens) {
		return { text, clamped: false };
	}
	const next = headTailClamp(text, opts.keepHeadChars, opts.keepTailChars);
	if (next === text) return { text, clamped: false };
	return { text: next, clamped: true };
}

function clampToolCallInput(
	input: unknown,
	opts: ClampOptions,
): { input: unknown; clamped: boolean } {
	const asText =
		typeof input === "string"
			? input
			: (() => {
					try {
						return JSON.stringify(input);
					} catch {
						return String(input);
					}
				})();
	const tokens = estimateTextTokens(asText);
	if (tokens <= opts.maxPartTokens) {
		return { input, clamped: false };
	}
	const clamped = headTailClamp(asText, opts.keepHeadChars, opts.keepTailChars);
	return {
		input: { _clamped: clamped },
		clamped: true,
	};
}

/**
 * Head/tail-truncate oversized assistant text and tool-call args in place.
 * Does not rewrite user prompts, system messages, or tool *results*.
 */
export function clampOversizedMessages(
	messages: readonly CoreMessage[],
	opts: ClampOptions,
): ClampResult {
	const clampToolCallArgs = opts.clampToolCallArgs !== false;
	let clampedParts = 0;
	const next: CoreMessage[] = messages.map((message) => {
		if (message.role === "system" || message.role === "user") {
			return message;
		}
		if (message.role === "assistant") {
			const content = message.content;
			if (typeof content === "string") {
				const { text, clamped } = clampStringIfNeeded(content, opts);
				if (clamped) {
					clampedParts += 1;
					return { ...message, content: text };
				}
				return message;
			}
			if (!Array.isArray(content)) return message;
			let partChanged = false;
			const parts = content.map((part) => {
				if (
					part &&
					typeof part === "object" &&
					"type" in part &&
					(part as { type: string }).type === "text" &&
					"text" in part &&
					typeof (part as { text: unknown }).text === "string"
				) {
					const { text, clamped } = clampStringIfNeeded(
						(part as { text: string }).text,
						opts,
					);
					if (clamped) {
						clampedParts += 1;
						partChanged = true;
						return { ...part, text };
					}
					return part;
				}
				if (clampToolCallArgs && isToolCallPart(part)) {
					const rec = part as {
						input?: unknown;
						args?: unknown;
					};
					const rawInput = rec.input ?? rec.args;
					const { input, clamped } = clampToolCallInput(rawInput, opts);
					if (clamped) {
						clampedParts += 1;
						partChanged = true;
						return { ...part, input };
					}
					return part;
				}
				return part;
			});
			if (!partChanged) return message;
			return { ...message, content: parts } as CoreMessage;
		}
		return message;
	});

	return {
		messages: next,
		clampedParts,
		changed: clampedParts > 0,
	};
}
