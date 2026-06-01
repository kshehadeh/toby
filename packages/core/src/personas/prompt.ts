import type { Persona } from "../config/index";

export function composeSystemPromptWithPersona(
	basePrompt: string,
	persona?: Persona,
): string {
	if (!persona?.instructions) {
		return basePrompt;
	}

	if (persona.promptMode === "replace") {
		return persona.instructions;
	}

	return `${basePrompt}\n\nAdditional instructions from your persona "${persona.name}":\n${persona.instructions}`;
}
