import { clearToolCacheSlashCommand } from "./clear-tool-cache";
import { configSlashCommand } from "./config";
import { connectSlashCommand } from "./connect";
import { disconnectSlashCommand } from "./disconnect";
import { exitSlashCommand } from "./exit";
import { helpSlashCommand } from "./help";
import { integrationSlashCommand } from "./integration";
import { listenSlashCommand } from "./listen";
import { logSlashCommand } from "./log";
import { newSlashCommand } from "./new";
import { personaSlashCommand } from "./persona";
import { planSlashCommand } from "./plan";
import { restartSlashCommand } from "./restart";
import { schedulesSlashCommand } from "./schedules";
import { sessionsSlashCommand } from "./sessions";
import { skillsSlashCommand } from "./skills";
import { startDaemonSlashCommand } from "./start-daemon";
import { stopDaemonSlashCommand } from "./stop-daemon";
import { stopListeningSlashCommand } from "./stop-listening";
import { terminalSlashCommand } from "./terminal";
import type { SlashCommand } from "./types";
import { upgradeSlashCommand } from "./upgrade";
import { webSlashCommand } from "./web";

interface SlashCommandResolution {
	readonly kind: "none" | "execute" | "unknown";
	readonly command?: SlashCommand;
	readonly rawArgs?: string;
	readonly attemptedToken?: string;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
	clearToolCacheSlashCommand,
	configSlashCommand,
	connectSlashCommand,
	disconnectSlashCommand,
	helpSlashCommand,
	integrationSlashCommand,
	listenSlashCommand,
	logSlashCommand,
	planSlashCommand,
	personaSlashCommand,
	newSlashCommand,
	schedulesSlashCommand,
	sessionsSlashCommand,
	skillsSlashCommand,
	startDaemonSlashCommand,
	stopDaemonSlashCommand,
	stopListeningSlashCommand,
	terminalSlashCommand,
	upgradeSlashCommand,
	webSlashCommand,
	restartSlashCommand,
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
	const trimmed = line.trim();
	const normalized = trimmed.toLowerCase();
	if (!normalized) {
		return { kind: "none" };
	}

	const firstToken = normalized.split(/\s+/, 1)[0] ?? "";
	const rawArgs = trimmed.slice(firstToken.length).trim();
	const tokenOnlyCommand =
		firstToken.startsWith("/") && firstToken === normalized;
	const exactCommand = SLASH_COMMANDS.find(
		(item) => item.command === firstToken,
	);
	const chosen = exactCommand ?? (tokenOnlyCommand ? selectedSuggestion : null);

	if (chosen) {
		return { kind: "execute", command: chosen, rawArgs };
	}
	if (tokenOnlyCommand) {
		return { kind: "unknown", attemptedToken: line.trim() };
	}
	return { kind: "none" };
}

export type { SlashCommand } from "./types";
