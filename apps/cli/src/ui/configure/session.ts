import { AI_PROVIDERS } from "../../ai/providers";
import type { ChatInboundConfig } from "../../config/index";
import {
	type CredentialsFile,
	type Persona,
	clearDefaultPersona,
	getDefaultPersonaName,
	readConfig,
	readCredentials,
	setDefaultPersona,
	writeConfig,
	writeCredentials,
} from "../../config/index";
import { getIntegrationModules } from "../../integrations/index";
import {
	ALL_PROVIDER_CATEGORIES,
	type ProviderCategory,
} from "../../integrations/types";
import { DEFAULT_CHAT_PERSONA } from "../../personas/index";
import type { SettingsItem } from "./items";
import { buildSettingsTree } from "./items";

interface ConfigureSession {
	readonly initialTree: SettingsItem;
	readonly initialValues: Record<string, string>;
	readonly onSave: (values: Record<string, string>) => void;
	readonly refreshTree: (values: Record<string, string>) => SettingsItem;
	readonly callbacks: {
		readonly onCreatePersona: () => string;
		readonly onDeletePersona: (name: string) => void;
		readonly onSetDefaultPersona: (name: string) => void;
		readonly onClearDefaultPersona: () => void;
	};
}

/**
 * After callbacks mutate `initialValues` (e.g. `onCreatePersona`), rebuild `initialTree`
 * so ConfigureApp receives a tree that includes new persona sections.
 */
export function refreshConfigureSessionTree(
	session: ConfigureSession,
): ConfigureSession {
	return {
		...session,
		initialTree: session.refreshTree(session.initialValues),
	};
}

export function createConfigureSession(): ConfigureSession {
	const creds = readCredentials();
	const config = readConfig();

	const credentialValues: Record<string, string> = {};
	for (const mod of getIntegrationModules()) {
		Object.assign(credentialValues, mod.seedCredentialValues(creds));
	}
	if (creds.ai?.openai?.token) {
		credentialValues["ai.openai.token"] = creds.ai.openai.token;
	}
	if (creds.ai?.vercel?.apiKey) {
		credentialValues["ai.vercel.apiKey"] = creds.ai.vercel.apiKey;
	}
	for (const p of config.personas) {
		credentialValues[`personas.${p.name}.name`] = p.name;
		credentialValues[`personas.${p.name}.instructions`] = p.instructions;
		credentialValues[`personas.${p.name}.promptMode`] = p.promptMode;
		credentialValues[`personas.${p.name}.ai.provider`] = p.ai.provider;
		credentialValues[`personas.${p.name}.ai.model`] = p.ai.model;
	}
	for (const cat of ALL_PROVIDER_CATEGORIES) {
		const current = config.defaultProviders?.[cat];
		credentialValues[`defaults.${cat}`] = current ?? "(none)";
	}

	credentialValues["chatInbound.enabled"] =
		config.chatInbound?.enabled === true ? "true" : "false";
	credentialValues["chatInbound.integration"] =
		config.chatInbound?.integration?.trim() || "(none)";
	credentialValues["chatInbound.persona"] =
		config.chatInbound?.persona?.trim() || "(default)";

	for (const mod of getIntegrationModules()) {
		if (!mod.chatInbound) continue;
		const entry = config.integrations[mod.name] as
			| { inboundEnabled?: boolean }
			| undefined;
		credentialValues[`${mod.name}.inboundEnabled`] =
			entry?.inboundEnabled === true ? "true" : "false";
	}

	const refreshTree = (vals: Record<string, string>) => {
		const freshConfig = readConfig();
		const personasFromVals = rebuildPersonas(vals, freshConfig.personas);
		const defaultProvidersFromVals = rebuildDefaultProviders(vals);
		return buildSettingsTree(
			personasFromVals,
			AI_PROVIDERS,
			vals,
			defaultProvidersFromVals,
		);
	};

	const callbacks = {
		onCreatePersona: (): string => {
			const cfg = readConfig();
			const name = `Persona ${cfg.personas.length + 1}`;
			const defaults = DEFAULT_CHAT_PERSONA;
			cfg.personas.push({
				name,
				instructions: defaults.instructions,
				promptMode: defaults.promptMode,
				ai: { provider: defaults.ai.provider, model: defaults.ai.model },
			});
			writeConfig(cfg);
			credentialValues[`personas.${name}.name`] = name;
			credentialValues[`personas.${name}.instructions`] = defaults.instructions;
			credentialValues[`personas.${name}.promptMode`] = defaults.promptMode;
			credentialValues[`personas.${name}.ai.provider`] = defaults.ai.provider;
			credentialValues[`personas.${name}.ai.model`] = defaults.ai.model;
			return name;
		},
		onDeletePersona: (personaName: string) => {
			const cfg = readConfig();
			cfg.personas = cfg.personas.filter((p) => p.name !== personaName);
			if (cfg.defaultPersona === personaName) {
				cfg.defaultPersona = undefined;
			}
			writeConfig(cfg);
			for (const key of Object.keys(credentialValues)) {
				if (key.startsWith(`personas.${personaName}.`)) {
					delete credentialValues[key];
				}
			}
		},
		onSetDefaultPersona: (personaName: string) => {
			setDefaultPersona(personaName);
		},
		onClearDefaultPersona: () => {
			clearDefaultPersona();
		},
	};

	return {
		initialTree: refreshTree(credentialValues),
		initialValues: credentialValues,
		onSave: (values) => {
			const updated = buildCredentialsFromValues(values, creds);
			writeCredentials(updated);

			const cfg = readConfig();
			cfg.personas = rebuildPersonas(values, cfg.personas);
			cfg.defaultProviders = rebuildDefaultProviders(values);
			cfg.chatInbound = rebuildChatInbound(values);
			applyIntegrationInboundFlags(cfg, values);
			writeConfig(cfg);
		},
		refreshTree,
		callbacks,
	};
}

function buildCredentialsFromValues(
	values: Record<string, string>,
	creds: CredentialsFile,
): CredentialsFile {
	let next: CredentialsFile = { ...creds };
	for (const mod of getIntegrationModules()) {
		const patch = mod.mergeCredentialsPatch(values, creds);
		next = mergeCredentials(next, patch);
	}

	const token = values["ai.openai.token"] ?? creds.ai?.openai?.token ?? "";
	const vercelApiKey =
		values["ai.vercel.apiKey"] ?? creds.ai?.vercel?.apiKey ?? "";
	next = mergeCredentials(next, {
		ai: {
			openai: { token },
			vercel: { apiKey: vercelApiKey },
		},
	});
	return next;
}

function mergeCredentials<T>(base: T, patch: Partial<T>): T {
	const out: Record<string, unknown> = { ...(base as unknown as object) };
	for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
		if (value === undefined) continue;
		const existing = out[key];
		if (isPlainObject(existing) && isPlainObject(value)) {
			out[key] = mergeCredentials(
				existing as Record<string, unknown>,
				value as Record<string, unknown>,
			);
		} else {
			out[key] = value;
		}
	}
	return out as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

function rebuildChatInbound(values: Record<string, string>): ChatInboundConfig {
	const enabled = values["chatInbound.enabled"] === "true";
	const integrationRaw = values["chatInbound.integration"]?.trim();
	const integration =
		integrationRaw && integrationRaw !== "(none)" ? integrationRaw : undefined;
	const personaRaw = values["chatInbound.persona"]?.trim();
	const persona =
		personaRaw && personaRaw !== "(default)" ? personaRaw : undefined;
	return { enabled, integration, persona };
}

function applyIntegrationInboundFlags(
	cfg: ReturnType<typeof readConfig>,
	values: Record<string, string>,
): void {
	const inbound = rebuildChatInbound(values);
	for (const mod of getIntegrationModules()) {
		if (!mod.chatInbound) continue;
		let flag = values[`${mod.name}.inboundEnabled`] === "true";
		if (inbound.enabled && inbound.integration === mod.name) {
			flag = true;
		}
		const existing = cfg.integrations[mod.name] ?? {};
		cfg.integrations[mod.name] = {
			...existing,
			inboundEnabled: flag,
		};
	}
}

function rebuildDefaultProviders(
	values: Record<string, string>,
): Partial<Record<ProviderCategory, string>> {
	const out: Partial<Record<ProviderCategory, string>> = {};
	for (const cat of ALL_PROVIDER_CATEGORIES) {
		const val = values[`defaults.${cat}`];
		if (val && val !== "(none)") {
			out[cat] = val;
		}
	}
	return out;
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
