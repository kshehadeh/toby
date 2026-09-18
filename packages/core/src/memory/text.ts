import { createHash } from "node:crypto";

/** Canonical string used for exact-duplicate hashing. */
export function normalizeMemoryText(
	value: string,
	subject?: string | null,
): string {
	const subj = (subject ?? "").trim().toLowerCase();
	const body = value.trim().toLowerCase().replace(/\s+/g, " ");
	return `${subj}\n${body}`;
}

/** SHA-256 of {@link normalizeMemoryText} for exact dedup without embeddings. */
export function memoryContentHash(
	value: string,
	subject?: string | null,
): string {
	return createHash("sha256")
		.update(normalizeMemoryText(value, subject))
		.digest("hex");
}

/** Text embedded for a memory item — subject (if any) then value. */
export function formatMemoryEmbedText(item: {
	readonly value: string;
	readonly subject?: string | null;
}): string {
	const subject = item.subject?.trim();
	const value = item.value.trim();
	return subject ? `${subject}\n${value}` : value;
}

/**
 * True when `next` is a stricter restatement of `previous`: longer, and
 * contains the previous text (case-insensitive).
 */
export function isMoreSpecificMemoryValue(
	next: string,
	previous: string,
): boolean {
	const n = next.trim();
	const p = previous.trim();
	if (n.length <= p.length) {
		return false;
	}
	return n.toLowerCase().includes(p.toLowerCase());
}
