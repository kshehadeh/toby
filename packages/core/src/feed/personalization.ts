import { createHash } from "node:crypto";
import { listUsableForPrompt } from "../memory/memory-service";
import { DEFAULT_MEMORY_USER_ID, isUsableForPrompt } from "../memory/prompt";
import type { MemoryItem } from "../memory/types";
import type { FeedFeedback, FeedState } from "./state";

/** Prompt budget for memories (characters). */
const MEMORY_MAX_CHARS = 2500;
const MEMORY_LIMIT = 60;
/** Most recent "Not relevant" marks shown to the ranker. */
const FEEDBACK_LIMIT = 15;

/**
 * What the ranker knows about the user: Toby memories (durable facts and
 * preferences) and recent "Not relevant" marks.
 */
export interface FeedPersonalization {
	readonly memories: readonly string[];
	readonly notRelevant: readonly string[];
}

export const EMPTY_PERSONALIZATION: FeedPersonalization = {
	memories: [],
	notRelevant: [],
};

/** One-line memory text; sensitive memories are left out of the Feed. */
export function memoryLines(
	items: readonly MemoryItem[],
	nowMs = Date.now(),
	maxChars = MEMORY_MAX_CHARS,
): string[] {
	const lines: string[] = [];
	let used = 0;
	for (const item of items) {
		if (!isUsableForPrompt(item, nowMs) || item.sensitivity !== "normal")
			continue;
		const subject = item.subject?.trim();
		const line = `${item.type}${subject ? ` (${subject})` : ""}: ${item.value.trim().replace(/\s+/g, " ")}`;
		if (used + line.length > maxChars) break;
		lines.push(line);
		used += line.length;
	}
	return lines;
}

export function feedbackLines(
	feedback: readonly FeedFeedback[],
	limit = FEEDBACK_LIMIT,
): string[] {
	return feedback
		.slice(-limit)
		.reverse()
		.map(
			(f) =>
				`[${f.category}] ${f.title}${f.subtitle ? ` — ${f.subtitle}` : ""}`,
		);
}

export function buildFeedPersonalization(
	state: FeedState,
	deps: { readonly listMemories?: () => readonly MemoryItem[] } = {},
): FeedPersonalization {
	let memories: string[] = [];
	try {
		const items =
			deps.listMemories?.() ??
			listUsableForPrompt(DEFAULT_MEMORY_USER_ID, { limit: MEMORY_LIMIT });
		memories = memoryLines(items);
	} catch {
		memories = [];
	}
	return { memories, notRelevant: feedbackLines(state.feedback) };
}

/** Prompt section; empty when there is nothing to personalize with. */
export function formatPersonalizationForPrompt(p: FeedPersonalization): string {
	const parts: string[] = [];
	if (p.memories.length > 0) {
		parts.push(
			`What you know about the user (from Toby memory). Use it to judge relevance — favor items tied to their people, projects, and interests:\n${p.memories.map((m) => `- ${m}`).join("\n")}`,
		);
	}
	if (p.notRelevant.length > 0) {
		parts.push(
			`Items the user recently marked "not relevant". Rank similar items (same sender, channel, topic, or kind) lower or leave them out:\n${p.notRelevant.map((m) => `- ${m}`).join("\n")}`,
		);
	}
	return parts.join("\n\n");
}

/** Stable hash so a personalization change re-ranks the Feed. */
export function personalizationSignature(p: FeedPersonalization): string {
	return createHash("sha256")
		.update(JSON.stringify(p))
		.digest("hex")
		.slice(0, 16);
}
