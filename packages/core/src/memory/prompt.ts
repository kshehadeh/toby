import type { MemoryItem } from "./types";

export const DEFAULT_MEMORY_USER_ID = "default";

/** Marker appended to system prompts when usable memories are inlined. */
export const MEMORY_INSTRUCTIONS_APPENDIX_START =
	"\n\n---\n\n## Known memories\n\n";

/** Max size of the memories appendix (characters), including the heading. */
export const MEMORY_INSTRUCTIONS_MAX_CHARS = 20_000;

const INTRO =
	"These are durable facts the user asked Toby to remember. Treat them as known context. They are not this Mac's current GPS location. If something you need is not listed, use memorySearch.\n\n";

export function isMemoryExpired(
	item: Pick<MemoryItem, "expiresAt">,
	nowMs = Date.now(),
): boolean {
	const raw = item.expiresAt?.trim();
	if (!raw) return false;
	const ms = Date.parse(raw);
	return Number.isFinite(ms) && ms <= nowMs;
}

export function isUsableForPrompt(
	item: Pick<MemoryItem, "visibility" | "expiresAt">,
	nowMs = Date.now(),
): boolean {
	return item.visibility === "usable_by_ai" && !isMemoryExpired(item, nowMs);
}

function formatMemoryLine(item: MemoryItem): string {
	const subject = item.subject?.trim();
	const label = subject ? `**${item.type}** (${subject})` : `**${item.type}**`;
	return `- ${label}: ${item.value.trim()}\n`;
}

/**
 * Build the system-prompt memories section from already-filtered items.
 * Includes as many newest-first items as fit under {@link MEMORY_INSTRUCTIONS_MAX_CHARS}.
 * Returns an empty string when there is nothing to include.
 */
export function formatMemoriesForInstructions(
	items: readonly MemoryItem[],
	options?: { readonly maxChars?: number; readonly nowMs?: number },
): string {
	const maxChars = options?.maxChars ?? MEMORY_INSTRUCTIONS_MAX_CHARS;
	const nowMs = options?.nowMs ?? Date.now();
	const eligible = items.filter((item) => isUsableForPrompt(item, nowMs));
	if (eligible.length === 0) {
		return "";
	}

	const header = `${MEMORY_INSTRUCTIONS_APPENDIX_START}${INTRO}`;
	if (header.length >= maxChars) {
		return "";
	}

	let body = header;
	let included = 0;
	for (let i = 0; i < eligible.length; i++) {
		const item = eligible[i];
		if (!item) continue;
		const line = formatMemoryLine(item);
		if (body.length + line.length <= maxChars) {
			body += line;
			included += 1;
			continue;
		}
		if (included === 0) {
			const room = maxChars - body.length;
			if (room > 20) {
				body += `${line.slice(0, room - 1).trimEnd()}…\n`;
				included += 1;
			}
			break;
		}
		const omitted = eligible.length - included;
		const note = `(${omitted} more memories omitted due to size; use memorySearch.)\n`;
		if (body.length + note.length <= maxChars) {
			body += note;
		}
		break;
	}

	return included === 0 ? "" : body;
}
