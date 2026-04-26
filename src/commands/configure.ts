import type { Command } from "commander";
import { AI_PROVIDERS } from "../ai/providers";
import {
	type CredentialsFile,
	type Persona,
	readConfig,
	readCredentials,
	writeConfig,
	writeCredentials,
} from "../config/index";
import { getIntegrationModules } from "../integrations/index";
import { runConfigureUI } from "../ui/configure/App";
import { buildSettingsTree } from "../ui/configure/items";

export function registerConfigureCommand(program: Command): void {
	program
		.command("configure")
		.description("Configure Toby settings (integrations, credentials, etc.)")
		.action(() => {
			const creds = readCredentials();
			const config = readConfig();

			const credentialValues: Record<string, string> = {};
			for (const mod of getIntegrationModules()) {
				Object.assign(credentialValues, mod.seedCredentialValues(creds));
			}
			if (creds.ai?.openai?.token)
				credentialValues["ai.openai.token"] = creds.ai.openai.token;
			for (const p of config.personas) {
				credentialValues[`personas.${p.name}.name`] = p.name;
				credentialValues[`personas.${p.name}.instructions`] = p.instructions;
				credentialValues[`personas.${p.name}.promptMode`] = p.promptMode;
				credentialValues[`personas.${p.name}.ai.provider`] = p.ai.provider;
				credentialValues[`personas.${p.name}.ai.model`] = p.ai.model;
			}

			const buildTree = (vals: Record<string, string>) => {
				const freshConfig = readConfig();
				const personasFromVals = rebuildPersonas(vals, freshConfig.personas);
				return buildSettingsTree(personasFromVals, AI_PROVIDERS);
			};

			const onCreatePersona = (): string => {
				const cfg = readConfig();
				const name = `Persona ${cfg.personas.length + 1}`;
				cfg.personas.push({
					name,
					instructions: "",
					promptMode: "add",
					ai: { provider: "openai", model: "gpt-5-mini" },
				});
				writeConfig(cfg);
				credentialValues[`personas.${name}.name`] = name;
				credentialValues[`personas.${name}.instructions`] = "";
				credentialValues[`personas.${name}.promptMode`] = "add";
				credentialValues[`personas.${name}.ai.provider`] = "openai";
				credentialValues[`personas.${name}.ai.model`] = "gpt-5-mini";
				return name;
			};

			const onDeletePersona = (personaName: string) => {
				const cfg = readConfig();
				cfg.personas = cfg.personas.filter((p) => p.name !== personaName);
				writeConfig(cfg);
				for (const key of Object.keys(credentialValues)) {
					if (key.startsWith(`personas.${personaName}.`)) {
						delete credentialValues[key];
					}
				}
			};

			const initialTree = buildTree(credentialValues);

			runConfigureUI(
				initialTree,
				credentialValues,
				(values) => {
					const updated = buildCredentialsFromValues(values, creds);
					writeCredentials(updated);

					const cfg = readConfig();
					cfg.personas = rebuildPersonas(values, cfg.personas);
					writeConfig(cfg);
				},
				buildTree,
				{ onCreatePersona, onDeletePersona },
			);
		});
}

function buildCredentialsFromValues(
	values: Record<string, string>,
	creds: CredentialsFile,
): CredentialsFile {
	const gmail = {
		clientId: creds.gmail?.clientId ?? "",
		clientSecret: creds.gmail?.clientSecret ?? "",
	};
	const todoist = {
		apiKey: creds.todoist?.apiKey ?? "",
	};

	for (const mod of getIntegrationModules()) {
		const patch = mod.mergeCredentialsPatch(values, creds);
		if (patch.gmail) {
			Object.assign(gmail, patch.gmail);
		}
		if (patch.todoist) {
			Object.assign(todoist, patch.todoist);
		}
	}

	return {
		gmail,
		todoist,
		ai: {
			openai: {
				token: values["ai.openai.token"] ?? creds.ai?.openai?.token ?? "",
			},
		},
	};
}

function rebuildPersonas(
	values: Record<string, string>,
	existing: Persona[],
): Persona[] {
	const names = new Set<string>();
	for (const key of Object.keys(values)) {
		if (key.startsWith("personas.") && key.endsWith(".name")) {
			names.add(values[key]);
		}
	}

	return [...names].map((name) => {
		const existingPersona = existing.find((p) => p.name === name);
		return {
			name: values[`personas.${name}.name`] ?? name,
			instructions:
				values[`personas.${name}.instructions`] ??
				existingPersona?.instructions ??
				"",
			promptMode:
				values[`personas.${name}.promptMode`] === "replace"
					? "replace"
					: existingPersona?.promptMode === "replace"
						? "replace"
						: "add",
			ai: {
				provider:
					values[`personas.${name}.ai.provider`] ??
					existingPersona?.ai.provider ??
					"openai",
				model:
					values[`personas.${name}.ai.model`] ??
					existingPersona?.ai.model ??
					"gpt-5-mini",
			},
		};
	});
}
