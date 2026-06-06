import fs from "node:fs";
import { resolveTobyDir } from "@toby/core/config/index";

const PROMPT_HISTORY_FILE = "prompt-history.json";
const MAX_PROMPT_HISTORY = 100;

function getPromptHistoryPath(): string {
	return `${resolveTobyDir()}/${PROMPT_HISTORY_FILE}`;
}

function normalizePrompt(line: string): string | null {
	const trimmed = line.trim();
	if (!trimmed) {
		return null;
	}
	if (trimmed.startsWith("/")) {
		return null;
	}
	return trimmed;
}

export function loadPromptHistory(): string[] {
	const path = getPromptHistoryPath();
	if (!fs.existsSync(path)) {
		return [];
	}
	try {
		const raw = fs.readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) {
			return [];
		}
		const out: string[] = [];
		for (const item of parsed) {
			if (typeof item !== "string") continue;
			const normalized = normalizePrompt(item);
			if (normalized) {
				out.push(normalized);
			}
		}
		return out.slice(-MAX_PROMPT_HISTORY);
	} catch {
		return [];
	}
}

export function appendPromptHistory(line: string): string[] {
	const normalized = normalizePrompt(line);
	if (!normalized) {
		return loadPromptHistory();
	}

	const previous = loadPromptHistory();
	const withoutDup =
		previous.length > 0 && previous[previous.length - 1] === normalized
			? previous
			: [...previous, normalized];
	const next = withoutDup.slice(-MAX_PROMPT_HISTORY);

	const path = getPromptHistoryPath();
	const dir = resolveTobyDir();
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	fs.writeFileSync(path, JSON.stringify(next, null, 2));
	return next;
}
