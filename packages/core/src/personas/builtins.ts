import type { Persona } from "../config/index";
import { DEFAULT_TOBY_INSTRUCTIONS } from "./default-instructions";
import { MAILMAN_INSTRUCTIONS } from "./mailman-instructions";

const DEFAULT_BUILTIN_AI = {
	provider: "openai",
	model: "gpt-5-mini",
} as const;

export const DEFAULT_CHAT_PERSONA: Persona = {
	name: "Toby",
	instructions: DEFAULT_TOBY_INSTRUCTIONS,
	promptMode: "add",
	ai: { ...DEFAULT_BUILTIN_AI },
	imagePath: "toby.png",
};

export const MAILMAN_PERSONA: Persona = {
	name: "Mailman",
	instructions: MAILMAN_INSTRUCTIONS,
	promptMode: "add",
	ai: { ...DEFAULT_BUILTIN_AI },
	imagePath: "mailman.png",
};

/** Shipped personas. Order is the Settings / picker order.
 * Portraits live in `packages/core/assets/personas/<imagePath>`. */
export const BUILTIN_PERSONAS: readonly Persona[] = [
	DEFAULT_CHAT_PERSONA,
	MAILMAN_PERSONA,
];

export function isBuiltInPersonaName(name: string): boolean {
	return BUILTIN_PERSONAS.some((persona) => persona.name === name);
}

export function getBuiltInPersona(name: string): Persona | undefined {
	return BUILTIN_PERSONAS.find((persona) => persona.name === name);
}
