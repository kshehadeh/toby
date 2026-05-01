import { clearToolCacheSlashCommand } from "./clear-tool-cache";
import { configSlashCommand } from "./config";
import { exitSlashCommand } from "./exit";
import { helpSlashCommand } from "./help";
import { integrationSlashCommand } from "./integration";
import { newSlashCommand } from "./new";
import { personaSlashCommand } from "./persona";
import { sessionsSlashCommand } from "./sessions";
import type { SlashCommand } from "./types";

interface SlashCommandResolution {
	readonly kind: "none" | "execute" | "unknown";
	readonly command?: SlashCommand;
	readonly attemptedToken?: string;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
	clearToolCacheSlashCommand,
	configSlashCommand,
	helpSlashCommand,
	integrationSlashCommand,
	personaSlashCommand,
	newSlashCommand,
	sessionsSlashCommand,
	exitSlashCommand,
];

export function getSlashSuggestions(input: string): SlashCommand[] {
	const normalized = input.trim().toLowerCase();
	if (!normalized.startsWith("/")) {
		return [];
	}
	if (/\s/.test(normalized)) {
		return [];
	}
	return SLASH_COMMANDS.filter((item) => item.command.startsWith(normalized));
}

export function getNearestSlashCommand(input: string): SlashCommand | null {
	const normalized = input.trim().toLowerCase();
	const suggestions = getSlashSuggestions(input);
	if (suggestions.length === 0) {
		return null;
	}
	const exact = suggestions.find((item) => item.command === normalized);
	if (exact) {
		return exact;
	}
	return suggestions.reduce((best, item) => {
		const bestDistance = best.command.length - normalized.length;
		const itemDistance = item.command.length - normalized.length;
		if (itemDistance < bestDistance) {
			return item;
		}
		if (itemDistance === bestDistance && item.command < best.command) {
			return item;
		}
		return best;
	});
}

export function resolveSlashSubmission(
	line: string,
	selectedSuggestion: SlashCommand | null,
): SlashCommandResolution {
	const normalized = line.trim().toLowerCase();
	if (!normalized) {
		return { kind: "none" };
	}

	const firstToken = normalized.split(/\s+/, 1)[0] ?? "";
	const tokenOnlyCommand =
		firstToken.startsWith("/") && firstToken === normalized;
	const exactCommand = SLASH_COMMANDS.find(
		(item) => item.command === normalized,
	);
	const chosen = exactCommand ?? (tokenOnlyCommand ? selectedSuggestion : null);

	if (chosen) {
		return { kind: "execute", command: chosen };
	}
	if (tokenOnlyCommand) {
		return { kind: "unknown", attemptedToken: line.trim() };
	}
	return { kind: "none" };
}

export type { SlashCommand } from "./types";
