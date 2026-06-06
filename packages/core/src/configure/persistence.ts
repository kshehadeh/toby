import type { ChatInboundConfig } from "../config/index";
import {
	type CredentialsFile,
	type Persona,
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
import type { ListenConfig } from "../listen/whisper-config";
import {
	resolveDefaultWhisperModelPath,
	resolveWhisperCliInstallTarget,
} from "../listen/whisper-config";
import { listSchedules, updateSchedule } from "../schedules/store";
import { loadLocalSkills } from "../skills/index";
import { updateSkillFrontmatter } from "../skills/manage";
import type { ConfigureListenRecording } from "./types";

const SECRET_KEY_PREFIXES = [
	"ai.openai.token",
	"ai.vercel.apiKey",
	"ai.huggingface.accessToken",
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
	if (creds.ai?.huggingface?.accessToken) {
		values["ai.huggingface.accessToken"] = creds.ai.huggingface.accessToken;
	}
	for (const p of config.personas) {
		values[`personas.${p.name}.name`] = p.name;
		values[`personas.${p.name}.instructions`] = p.instructions;
		values[`personas.${p.name}.promptMode`] = p.promptMode;
		values[`personas.${p.name}.ai.provider`] = p.ai.provider;
		values[`personas.${p.name}.ai.model`] = p.ai.model;
	}
	for (const skill of loadLocalSkills()) {
		values[`skills.${skill.dirName}.name`] = skill.name;
		values[`skills.${skill.dirName}.description`] = skill.description;
		values[`skills.${skill.dirName}.summary`] = skill.summary;
	}
	seedListenRecordingValues(values, options.listenRecordings ?? []);
	seedScheduleValues(values);
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
	values["listen.whisperCpp.binaryPath"] =
		config.listen?.whisperCpp?.binaryPath?.trim() ||
		resolveWhisperCliInstallTarget();
	values["listen.whisperCpp.modelPath"] =
		config.listen?.whisperCpp?.modelPath?.trim() ||
		resolveDefaultWhisperModelPath();
	values["listen.whisperCpp.language"] =
		config.listen?.whisperCpp?.language?.trim() || "auto";

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

export function rebuildListenConfig(
	values: Record<string, string>,
): ListenConfig {
	const binaryPath = values["listen.whisperCpp.binaryPath"]?.trim();
	const modelPath = values["listen.whisperCpp.modelPath"]?.trim();
	const language = values["listen.whisperCpp.language"]?.trim() || "auto";
	return {
		whisperCpp: {
			...(binaryPath ? { binaryPath } : {}),
			...(modelPath ? { modelPath } : {}),
			language,
		},
	};
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
	const huggingfaceAccessToken =
		values["ai.huggingface.accessToken"] ??
		creds.ai?.huggingface?.accessToken ??
		"";
	next = mergeCredentials(next, {
		ai: {
			openai: { token },
			vercel: { apiKey: vercelApiKey },
			huggingface: { accessToken: huggingfaceAccessToken },
		},
	});
	return next;
}

function applyConfigFromValues(values: Record<string, string>): void {
	const cfg = readConfig();
	cfg.personas = rebuildPersonas(values, cfg.personas);
	cfg.defaultProviders = rebuildDefaultProviders(values);
	cfg.chatInbound = rebuildChatInbound(values);
	cfg.listen = rebuildListenConfig(values);
	applyIntegrationInboundFlags(cfg, values);
	writeConfig(cfg);
}

const SKILL_FIELD_RE = /^skills\.([^.]+)\.(name|description|summary)$/;
const SCHEDULE_FIELD_RE =
	/^schedules\.([^.]+)\.(name|prompt|persona|cron|enabled)$/;

function partitionConfigurePatch(patch: Record<string, string>): {
	config: Record<string, string>;
	skills: Map<string, { name?: string; description?: string; summary?: string }>;
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
			else
				entry.enabled = value === "Yes" || value === "true";
			schedules.set(scheduleId, entry);
			continue;
		}

		config[key] = value;
	}

	return { config, skills, schedules };
}

/** Apply non-secret configure values (web-safe). */
export function applyConfigureValuesPatch(
	patch: Record<string, string>,
	baseValues?: Record<string, string>,
): void {
	const secretKeys = collectSecretConfigureKeys();
	for (const key of Object.keys(patch)) {
		if (secretKeys.has(key)) {
			throw new Error(`Cannot modify secret field: ${key}`);
		}
	}

	const { config, skills, schedules } = partitionConfigurePatch(patch);

	if (Object.keys(config).length > 0) {
		const merged = { ...(baseValues ?? seedConfigureValues()), ...config };
		applyConfigFromValues(merged);
	}

	for (const [dirName, updates] of skills) {
		updateSkillFrontmatter(dirName, updates);
	}

	for (const [scheduleId, updates] of schedules) {
		updateSchedule(scheduleId, updates);
	}
}

/** Full save including credentials (CLI configure only). */
export function saveConfigureValues(values: Record<string, string>): void {
	const creds = readCredentials();
	writeCredentials(buildCredentialsFromValues(values, creds));
	applyConfigFromValues(values);
}
