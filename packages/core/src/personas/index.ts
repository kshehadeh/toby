import {
	type Persona,
	getDefaultPersonaName,
	readConfig,
} from "../config/index";
import {
	BUILTIN_PERSONAS,
	DEFAULT_CHAT_PERSONA,
	getBuiltInPersona,
	isBuiltInPersonaName,
} from "./builtins";

export { DEFAULT_TOBY_INSTRUCTIONS } from "./default-instructions";
export { MAILMAN_INSTRUCTIONS } from "./mailman-instructions";
export {
	BUILTIN_PERSONAS,
	DEFAULT_CHAT_PERSONA,
	MAILMAN_PERSONA,
	getBuiltInPersona,
	isBuiltInPersonaName,
} from "./builtins";

/**
 * Built-in personas may be persisted so users can change provider and model.
 * Name, instructions, and promptMode stay locked to the shipped default so
 * prompt updates reach existing installs.
 */
export function withBuiltInPersonaDefaults(persona: Persona): Persona {
	const builtIn = getBuiltInPersona(persona.name);
	if (!builtIn) {
		return persona;
	}
	return {
		...persona,
		name: builtIn.name,
		instructions: builtIn.instructions,
		promptMode: builtIn.promptMode,
	};
}

function builtInWithResolvedAi(
	builtIn: Persona,
	configPersonas: readonly Persona[],
): Persona {
	const persisted = configPersonas.find(
		(persona) => persona.name === builtIn.name,
	);
	if (persisted) {
		return withBuiltInPersonaDefaults(persisted);
	}
	if (builtIn.name === DEFAULT_CHAT_PERSONA.name) {
		return builtIn;
	}
	const toby = configPersonas.find(
		(persona) => persona.name === DEFAULT_CHAT_PERSONA.name,
	);
	return {
		...builtIn,
		ai: toby?.ai ?? builtIn.ai,
	};
}

export function resolvePersona(name: string): Persona | undefined {
	const configPersonas = readConfig().personas;
	const fromConfig = configPersonas.find((persona) => persona.name === name);
	if (fromConfig) {
		return withBuiltInPersonaDefaults(fromConfig);
	}
	const builtIn = getBuiltInPersona(name);
	if (!builtIn) {
		return undefined;
	}
	return builtInWithResolvedAi(builtIn, configPersonas);
}

export function listPersonas(): Persona[] {
	const configPersonas = readConfig().personas;
	const builtIns = BUILTIN_PERSONAS.map((persona) =>
		builtInWithResolvedAi(persona, configPersonas),
	);
	const customs = configPersonas.filter(
		(persona) => !isBuiltInPersonaName(persona.name),
	);
	return [...builtIns, ...customs];
}

export function resolveDefaultPersona(): Persona {
	const name = getDefaultPersonaName() ?? DEFAULT_CHAT_PERSONA.name;
	const resolved = resolvePersona(name);
	return resolved ?? DEFAULT_CHAT_PERSONA;
}
