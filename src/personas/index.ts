import { type Persona, readConfig } from "../config/index";

export function resolvePersona(name: string): Persona | undefined {
	const config = readConfig();
	return config.personas.find((p) => p.name === name);
}

export function listPersonas(): Persona[] {
	return readConfig().personas;
}
