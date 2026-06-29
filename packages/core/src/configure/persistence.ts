import { getAIProvider } from "../ai/providers";
import type { AISettings, ChatInboundConfig } from "../config/index";
import {
	type CredentialsFile,
	type Persona,
	type TranscriptionConfig,
	type WebSearchConfig,
	readConfig,
	readCredentials,
	writeConfig,
	writeCredentials,
} from "../config/index";
import { getIntegrationModules } from "../integrations/index";
import {
	ALL_PROVIDER_CATEGORIES,
	type ProviderCategory,
} from "../integrations/types";
import { DEFAULT_CHAT_PERSONA } from "../personas/index";
import {
	type ProjectMetadataUpdate,
	listProjects,
	updateProjectMetadata,
} from "../projects/index";
import { listSchedules, updateSchedule } from "../schedules/store";
import { loadLocalSkills } from "../skills/index";
import { updateSkillFrontmatter } from "../skills/manage";
import type { ConfigureListenRecording } from "./types";

const SECRET_KEY_PREFIXES = [
	"ai.openai.token",
	"ai.vercel.apiKey",
	"ai.ollama.apiKey",
	"transcription.openai.apiKey",
	"transcription.groq.apiKey",
] as const;

/** Keys that must never be written via the web API. */
export function collectSecretConfigureKeys(): Set<string> {
	const keys = new Set<string>(SECRET_KEY_PREFIXES);
	for (const mod of getIntegrationModules()) {
		for (const d of mod.getCredentialDescriptors()) {
			if (d.masked) {
				keys.add(d.key);
			}
		}
	}
	return keys;
}

/**
 * All credential keys (masked and non-masked) from integration modules.
 * Used to route values to the credentials file during configure patch.
 * Unlike {@link collectSecretConfigureKeys}, this includes non-masked
 * fields (e.g. host, port, username) that still belong in credentials
 * but should not be redacted in API responses.
 */
export function collectCredentialConfigureKeys(): Set<string> {
	const keys = new Set<string>(SECRET_KEY_PREFIXES);
	for (const mod of getIntegrationModules()) {
		for (const d of mod.getCredentialDescriptors()) {
			keys.add(d.key);
		}
	}
	return keys;
}

export function seedListenRecordingValues(
	values: Record<string, string>,
	recordings: readonly ConfigureListenRecording[],
): void {
	for (const key of Object.keys(values)) {
		if (key.startsWith("listen.recordings.")) {
			delete values[key];
		}
	}
	for (const recording of recordings) {
		values[`listen.recordings.${recording.id}.name`] =
			recording.metadata.name ?? "";
		values[`listen.recordings.${recording.id}.description`] =
			recording.metadata.description ?? "";
	}
}

export function seedScheduleValues(values: Record<string, string>): void {
	for (const key of Object.keys(values)) {
		if (key.startsWith("schedules.")) {
			delete values[key];
		}
	}
	let schedules: ReturnType<typeof listSchedules> = [];
	try {
		schedules = listSchedules();
	} catch {
		schedules = [];
	}
	for (const schedule of schedules) {
		values[`schedules.${schedule.id}.name`] = schedule.name;
		values[`schedules.${schedule.id}.prompt`] = schedule.prompt;
		values[`schedules.${schedule.id}.persona`] = schedule.personaName;
		values[`schedules.${schedule.id}.cron`] = schedule.cronExpression;
		values[`schedules.${schedule.id}.enabled`] = schedule.enabled
			? "Yes"
			: "No";
	}
}

export interface SeedConfigureValuesOptions {
	readonly listenRecordings?: readonly ConfigureListenRecording[];
}

/** Load full configure values from disk (includes secrets — CLI only). */
export function seedConfigureValues(
	options: SeedConfigureValuesOptions = {},
): Record<string, string> {
	const creds = readCredentials();
	const config = readConfig();
	const values: Record<string, string> = {};

	for (const mod of getIntegrationModules()) {
		Object.assign(values, mod.seedCredentialValues(creds));
	}
	if (creds.ai?.openai?.token) {
		values["ai.openai.token"] = creds.ai.openai.token;
	}
	if (creds.ai?.vercel?.apiKey) {
		values["ai.vercel.apiKey"] = creds.ai.vercel.apiKey;
	}
	if (creds.ai?.ollama?.apiKey) {
		values["ai.ollama.apiKey"] = creds.ai.ollama.apiKey;
	}
	if (config.ai?.ollama?.baseUrl) {
		values["ai.ollama.baseUrl"] = config.ai.ollama.baseUrl;
	}
	if (config.ai?.customModels) {
		for (const [providerId, models] of Object.entries(config.ai.customModels)) {
			if (models.length > 0) {
				values[`ai.customModels.${providerId}`] = models.join("\n");
			}
		}
	}
	for (const p of config.personas) {
		values[`personas.${p.name}.name`] = p.name;
		values[`personas.${p.name}.instructions`] = p.instructions;
		values[`personas.${p.name}.promptMode`] = p.promptMode;
		values[`personas.${p.name}.ai.provider`] = p.ai.provider;
		values[`personas.${p.name}.ai.model`] = p.ai.model;
		values[`personas.${p.name}.imagePath`] = p.imagePath ?? "";
	}
	for (const skill of loadLocalSkills()) {
		values[`skills.${skill.dirName}.name`] = skill.name;
		values[`skills.${skill.dirName}.description`] = skill.description;
		values[`skills.${skill.dirName}.summary`] = skill.summary;
	}
	seedListenRecordingValues(values, options.listenRecordings ?? []);
	seedScheduleValues(values);
	for (const project of listProjects()) {
		values[`projects.${project.slug}.name`] = project.name;
		values[`projects.${project.slug}.skills`] = project.skills.join(", ");
		values[`projects.${project.slug}.integrations`] =
			project.integrations.join(", ");
	}
	for (const cat of ALL_PROVIDER_CATEGORIES) {
		const current = config.defaultProviders?.[cat];
		values[`defaults.${cat}`] = current ?? "(none)";
	}

	values["chatInbound.enabled"] =
		config.chatInbound?.enabled === true ? "true" : "false";
	values["chatInbound.integration"] =
		config.chatInbound?.integration?.trim() || "(none)";
	values["chatInbound.persona"] =
		config.chatInbound?.persona?.trim() || "(default)";
	if (config.transcription) {
		values["transcription.provider"] = config.transcription.provider;
		values["transcription.model"] = config.transcription.model;
	}
	if (creds.transcription) {
		for (const [providerId, entry] of Object.entries(creds.transcription)) {
			if (entry?.apiKey) {
				values[`transcription.${providerId}.apiKey`] = entry.apiKey;
			}
		}
	}
	values["webSearch.provider"] = config.webSearch?.provider ?? "ai-gateway";
	values["webSearch.enabled"] = config.webSearch?.enabled ? "true" : "false";

	for (const mod of getIntegrationModules()) {
		if (!mod.chatInbound) continue;
		const entry = config.integrations[mod.name] as
			| { inboundEnabled?: boolean }
			| undefined;
		values[`${mod.name}.inboundEnabled`] =
			entry?.inboundEnabled === true ? "true" : "false";
	}

	return values;
}

const REDACTED = "••••••";

/** Redact secret values for web/API display. */
export function redactConfigureValues(
	values: Record<string, string>,
): Record<string, string> {
	const secretKeys = collectSecretConfigureKeys();
	const out: Record<string, string> = { ...values };
	for (const key of secretKeys) {
		if (out[key]?.trim()) {
			out[key] = REDACTED;
		}
	}
	return out;
}

export function rebuildTranscriptionConfig(
	values: Record<string, string>,
): TranscriptionConfig | undefined {
	const provider = values["transcription.provider"]?.trim();
	const model = values["transcription.model"]?.trim();
	if (!provider || !model) return undefined;
	return { provider, model };
}

export function rebuildWebSearchConfig(
	values: Record<string, string>,
): WebSearchConfig | undefined {
	const provider = values["webSearch.provider"]?.trim();
	if (!provider) return undefined;
	const enabledValue = values["webSearch.enabled"]?.toLowerCase().trim();
	const enabled = enabledValue === "true" || enabledValue === "yes";
	return { provider, enabled };
}

export function rebuildChatInbound(
	values: Record<string, string>,
): ChatInboundConfig {
	const enabled = values["chatInbound.enabled"] === "true";
	const integrationRaw = values["chatInbound.integration"]?.trim();
	const integration =
		integrationRaw && integrationRaw !== "(none)" ? integrationRaw : undefined;
	const personaRaw = values["chatInbound.persona"]?.trim();
	const persona =
		personaRaw && personaRaw !== "(default)" ? personaRaw : undefined;
	return { enabled, integration, persona };
}

export function applyIntegrationInboundFlags(
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

export function rebuildDefaultProviders(
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

export function rebuildPersonas(
	values: Record<string, string>,
	existing: Persona[],
): Persona[] {
	const names = new Set<string>();
	for (const key of Object.keys(values)) {
		if (key.startsWith("personas.") && key.endsWith(".name")) {
			const name = values[key].trim();
			if (name) names.add(name);
			continue;
		}
		const aiMatch = /^personas\.([^.]+)\.ai\.(provider|model)$/.exec(key);
		if (aiMatch) {
			names.add(aiMatch[1]);
		}
	}

	return [...names].map((name) => {
		const existingPersona =
			existing.find((p) => p.name === name) ??
			(name === DEFAULT_CHAT_PERSONA.name ? DEFAULT_CHAT_PERSONA : undefined);
		const lockedBuiltInFields =
			name === DEFAULT_CHAT_PERSONA.name
				? {
						name: DEFAULT_CHAT_PERSONA.name,
						instructions:
							existing.find((p) => p.name === name)?.instructions ??
							DEFAULT_CHAT_PERSONA.instructions,
						promptMode:
							existing.find((p) => p.name === name)?.promptMode ??
							DEFAULT_CHAT_PERSONA.promptMode,
					}
				: null;
		return {
			name:
				lockedBuiltInFields?.name ?? values[`personas.${name}.name`] ?? name,
			instructions:
				lockedBuiltInFields?.instructions ??
				values[`personas.${name}.instructions`] ??
				existingPersona?.instructions ??
				"",
			promptMode:
				lockedBuiltInFields?.promptMode ??
				(values[`personas.${name}.promptMode`] === "replace"
					? "replace"
					: existingPersona?.promptMode === "replace"
						? "replace"
						: "add"),
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
			imagePath:
				values[`personas.${name}.imagePath`] ||
				existingPersona?.imagePath ||
				undefined,
		};
	});
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

export function buildCredentialsFromValues(
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
	const ollamaApiKey =
		values["ai.ollama.apiKey"] ?? creds.ai?.ollama?.apiKey ?? "";
	next = mergeCredentials(next, {
		ai: {
			openai: { token },
			vercel: { apiKey: vercelApiKey },
			ollama: { apiKey: ollamaApiKey },
		},
	});

	const transcriptionBlock: Record<string, { apiKey: string }> = {};
	for (const [key, value] of Object.entries(values)) {
		const match = /^transcription\.([^.]+)\.apiKey$/.exec(key);
		if (!match) continue;
		const providerId = match[1];
		const trimmed = value.trim();
		if (!trimmed || value === REDACTED) continue;
		transcriptionBlock[providerId] = { apiKey: trimmed };
	}
	if (Object.keys(transcriptionBlock).length > 0) {
		next = mergeCredentials(next, { transcription: transcriptionBlock });
	}
	return next;
}

const CUSTOM_MODELS_KEY_RE = /^ai\.customModels\.(.+)$/;

export function rebuildCustomModels(
	values: Record<string, string>,
): Record<string, string[]> | undefined {
	const out: Record<string, string[]> = {};
	for (const [key, value] of Object.entries(values)) {
		const match = CUSTOM_MODELS_KEY_RE.exec(key);
		if (!match) continue;
		const providerId = match[1];
		const models = [
			...new Set(
				value
					.split("\n")
					.map((s) => s.trim())
					.filter(Boolean),
			),
		];
		if (models.length > 0) {
			out[providerId] = models;
		}
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

export function rebuildAISettings(
	values: Record<string, string>,
): AISettings | undefined {
	const baseUrl = values["ai.ollama.baseUrl"]?.trim();
	const customModels = rebuildCustomModels(values);
	const out: {
		ollama?: { baseUrl: string };
		customModels?: Record<string, string[]>;
	} = {};
	if (baseUrl) {
		out.ollama = { baseUrl };
	}
	if (customModels) {
		out.customModels = customModels;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function applyConfigFromValues(values: Record<string, string>): void {
	const cfg = readConfig();
	cfg.personas = rebuildPersonas(values, cfg.personas);
	cfg.defaultProviders = rebuildDefaultProviders(values);
	cfg.chatInbound = rebuildChatInbound(values);
	cfg.transcription = rebuildTranscriptionConfig(values);
	cfg.webSearch = rebuildWebSearchConfig(values);
	cfg.ai = rebuildAISettings(values);
	applyIntegrationInboundFlags(cfg, values);
	writeConfig(cfg);
}

const SKILL_FIELD_RE = /^skills\.([^.]+)\.(name|description|summary)$/;
const SCHEDULE_FIELD_RE =
	/^schedules\.([^.]+)\.(name|prompt|persona|cron|enabled)$/;
const PROJECT_FIELD_RE = /^projects\.([^.]+)\.(name|skills|integrations)$/;

function partitionConfigurePatch(patch: Record<string, string>): {
	config: Record<string, string>;
	skills: Map<
		string,
		{ name?: string; description?: string; summary?: string }
	>;
	schedules: Map<
		string,
		{
			name?: string;
			prompt?: string;
			personaName?: string;
			cronExpression?: string;
			enabled?: boolean;
		}
	>;
	projects: Map<
		string,
		{ name?: string; skills?: string; integrations?: string }
	>;
} {
	const config: Record<string, string> = {};
	const skills = new Map<
		string,
		{ name?: string; description?: string; summary?: string }
	>();
	const schedules = new Map<
		string,
		{
			name?: string;
			prompt?: string;
			personaName?: string;
			cronExpression?: string;
			enabled?: boolean;
		}
	>();
	const projects = new Map<
		string,
		{ name?: string; skills?: string; integrations?: string }
	>();

	for (const [key, value] of Object.entries(patch)) {
		const skillMatch = SKILL_FIELD_RE.exec(key);
		if (skillMatch) {
			const [, dirName, field] = skillMatch;
			const entry = skills.get(dirName) ?? {};
			if (field === "name") entry.name = value;
			else if (field === "description") entry.description = value;
			else entry.summary = value;
			skills.set(dirName, entry);
			continue;
		}

		const scheduleMatch = SCHEDULE_FIELD_RE.exec(key);
		if (scheduleMatch) {
			const [, scheduleId, field] = scheduleMatch;
			const entry = schedules.get(scheduleId) ?? {};
			if (field === "name") entry.name = value;
			else if (field === "prompt") entry.prompt = value;
			else if (field === "persona") entry.personaName = value;
			else if (field === "cron") entry.cronExpression = value;
			else entry.enabled = value === "Yes" || value === "true";
			schedules.set(scheduleId, entry);
			continue;
		}

		const projectMatch = PROJECT_FIELD_RE.exec(key);
		if (projectMatch) {
			const [, slug, field] = projectMatch;
			const entry = projects.get(slug) ?? {};
			if (field === "name") entry.name = value;
			else if (field === "skills") entry.skills = value;
			else entry.integrations = value;
			projects.set(slug, entry);
			continue;
		}

		config[key] = value;
	}

	return { config, skills, schedules, projects };
}

/** Apply configure values (web-safe), including secret credentials. */
export function applyConfigureValuesPatch(
	patch: Record<string, string>,
	baseValues?: Record<string, string>,
): void {
	const credentialKeys = collectCredentialConfigureKeys();
	const secretKeys = collectSecretConfigureKeys();
	const credPatch: Record<string, string> = {};
	const rest: Record<string, string> = {};
	for (const [key, value] of Object.entries(patch)) {
		if (credentialKeys.has(key)) {
			// Never persist the redacted placeholder — it means "unchanged".
			if (!secretKeys.has(key) || value !== REDACTED) {
				credPatch[key] = value;
			}
		} else {
			rest[key] = value;
		}
	}

	if (Object.keys(credPatch).length > 0) {
		const creds = readCredentials();
		// Seed from disk so untouched credentials are preserved, then overlay the
		// changed credential(s) before rebuilding the credentials file.
		const merged = { ...seedConfigureValues(), ...credPatch };
		writeCredentials(buildCredentialsFromValues(merged, creds));
	}

	const { config, skills, schedules, projects } = partitionConfigurePatch(rest);

	if (Object.keys(config).length > 0) {
		const merged = { ...(baseValues ?? seedConfigureValues()), ...config };
		// When a persona model is set to a value not in the provider's built-in
		// list, automatically append it to the custom model list so it appears in
		// future selector sessions.
		for (const [key, value] of Object.entries(config)) {
			const modelMatch = /^personas\.(.+)\.ai\.model$/.exec(key);
			if (!modelMatch || !value.trim()) continue;
			const personaName = modelMatch[1];
			const providerId =
				merged[`personas.${personaName}.ai.provider`] ?? "openai";
			const provider = getAIProvider(providerId);
			if (!provider) continue;
			const builtIn = provider.models ?? [];
			const trimmed = value.trim();
			if (builtIn.includes(trimmed)) continue;
			const customKey = `ai.customModels.${providerId}`;
			const existing = (merged[customKey] ?? "")
				.split("\n")
				.map((s) => s.trim())
				.filter(Boolean);
			if (!existing.includes(trimmed)) {
				merged[customKey] = [...existing, trimmed].join("\n");
			}
		}
		applyConfigFromValues(merged);
	}

	for (const [dirName, updates] of skills) {
		updateSkillFrontmatter(dirName, updates);
	}

	for (const [scheduleId, updates] of schedules) {
		updateSchedule(scheduleId, updates);
	}

	for (const [slug, updates] of projects) {
		const name = updates.name?.trim() || undefined;
		const skills = updates.skills
			? updates.skills
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean)
			: undefined;
		const integrations = updates.integrations
			? updates.integrations
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean)
			: undefined;
		if (name || skills || integrations) {
			const projectUpdates: ProjectMetadataUpdate = {
				...(name ? { name } : {}),
				...(skills ? { skills } : {}),
				...(integrations ? { integrations } : {}),
			};
			try {
				updateProjectMetadata(slug, projectUpdates);
			} catch {
				// Project may have been deleted concurrently; ignore.
			}
		}
	}
}

/** Full save including credentials (CLI configure only). */
export function saveConfigureValues(values: Record<string, string>): void {
	const creds = readCredentials();
	writeCredentials(buildCredentialsFromValues(values, creds));
	applyConfigFromValues(values);
}
