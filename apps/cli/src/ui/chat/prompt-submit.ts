import { type SlashCommand, resolveSlashSubmission } from "./slash-commands";

export type PromptSubmitRoute =
	| { readonly kind: "empty" }
	| {
			readonly kind: "slash";
			readonly resolution: ReturnType<typeof resolveSlashSubmission>;
	  }
	| { readonly kind: "steering"; readonly line: string }
	| { readonly kind: "chat"; readonly line: string };

/**
 * Slash commands take precedence over steering prompts while a turn is active.
 */
export function routePromptSubmit(
	line: string,
	selectedSlashCommand: SlashCommand | null,
	loading: boolean,
): PromptSubmitRoute {
	const trimmed = line.trim();
	if (!trimmed) {
		return { kind: "empty" };
	}

	const slash = resolveSlashSubmission(trimmed, selectedSlashCommand);
	if (slash.kind === "execute" || slash.kind === "unknown") {
		return { kind: "slash", resolution: slash };
	}

	if (loading) {
		return { kind: "steering", line: trimmed };
	}

	return { kind: "chat", line: trimmed };
}
