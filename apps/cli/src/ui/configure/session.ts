import { AI_PROVIDERS } from "@toby/core/ai/providers";
import type { ChatInboundConfig } from "@toby/core/config/index";
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
} from "@toby/core/config/index";
import { getIntegrationModules } from "@toby/core/integrations/index";
import {
	ALL_PROVIDER_CATEGORIES,
	type ProviderCategory,
} from "@toby/core/integrations/types";
import type { ListenConfig } from "@toby/core/listen/whisper-config";
import {
	resolveDefaultWhisperModelPath,
	resolveWhisperCliInstallTarget,
} from "@toby/core/listen/whisper-config";
import { DEFAULT_CHAT_PERSONA } from "@toby/core/personas/index";
import { loadLocalSkills } from "@toby/core/skills/index";
import {
	deleteSkill,
	openSkillInEditor,
	updateSkillFrontmatter,
} from "@toby/core/skills/manage";
import {
	deleteListenRecording,
	openListenRecordingInFinder,
	updateListenRecordingMetadata,
} from "../../listen/session-controller";
import { executeSchedule } from "../../schedules/executor";
import {
	createSchedule,
	deleteSchedule,
	listSchedules,
	updateSchedule,
} from "../../schedules/store";
import type { CreateScheduleParams, Schedule } from "../../schedules/types";
import type { SettingsItem } from "./items";
import { buildSettingsTree } from "./items";
import {
	findListenRecordingById,
	seedListenRecordingValues,
} from "./listen-values";
import type { ListenControllerOptions } from "./use-listen-controller";

export interface ConfigureSessionOptions {
	readonly listenOptions?: ListenControllerOptions;
	readonly schedulesEnabled?: boolean;
}

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
		readonly onUpdateSkillField: (
			dirName: string,
			field: "name" | "description" | "summary",
			value: string,
		) => void;
		readonly onOpenSkillInEditor: (dirName: string) => void;
		readonly onDeleteSkill: (dirName: string) => void;
		readonly onUpdateRecordingField: (
			recordingId: string,
			field: "name" | "description",
			value: string,
		) => void;
		readonly onOpenRecordingInFinder: (recordingId: string) => void;
		readonly onDeleteRecording: (recordingId: string) => void;
		readonly onCreateSchedule: () => string;
		readonly onUpdateScheduleField: (
			scheduleId: string,
			field: "name" | "prompt" | "personaName" | "cronExpression" | "enabled",
			value: string | boolean,
		) => void;
		readonly onDeleteSchedule: (scheduleId: string) => void;
		readonly onRunScheduleNow: (scheduleId: string) => Promise<void>;
	};
	readonly listenRecordingsDir?: string;
}

function seedScheduleValues(values: Record<string, string>): void {
	for (const key of Object.keys(values)) {
		if (key.startsWith("schedules.")) {
			delete values[key];
		}
	}
	let schedules: Schedule[] = [];
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

function findScheduleById(scheduleId: string): Schedule | null {
	try {
		return listSchedules().find((s) => s.id === scheduleId) ?? null;
	} catch {
		return null;
	}
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

export function createConfigureSession(
	options: ConfigureSessionOptions = {},
): ConfigureSession {
	const listenRecordingsDir = options.listenOptions?.recordingsDir;
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
	for (const skill of loadLocalSkills()) {
		credentialValues[`skills.${skill.dirName}.name`] = skill.name;
		credentialValues[`skills.${skill.dirName}.description`] = skill.description;
		credentialValues[`skills.${skill.dirName}.summary`] = skill.summary;
	}
	seedListenRecordingValues(credentialValues, listenRecordingsDir);
	seedScheduleValues(credentialValues);
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
	credentialValues["listen.whisperCpp.binaryPath"] =
		config.listen?.whisperCpp?.binaryPath?.trim() ||
		resolveWhisperCliInstallTarget();
	credentialValues["listen.whisperCpp.modelPath"] =
		config.listen?.whisperCpp?.modelPath?.trim() ||
		resolveDefaultWhisperModelPath();
	credentialValues["listen.whisperCpp.language"] =
		config.listen?.whisperCpp?.language?.trim() || "auto";

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
		const withBuiltIn = personasFromVals.some(
			(p) => p.name === DEFAULT_CHAT_PERSONA.name,
		)
			? personasFromVals
			: [DEFAULT_CHAT_PERSONA, ...personasFromVals];
		const defaultProvidersFromVals = rebuildDefaultProviders(vals);
		return buildSettingsTree(
			withBuiltIn,
			AI_PROVIDERS,
			vals,
			defaultProvidersFromVals,
			listenRecordingsDir,
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
		onUpdateSkillField: (
			dirName: string,
			field: "name" | "description" | "summary",
			value: string,
		) => {
			updateSkillFrontmatter(dirName, { [field]: value });
			credentialValues[`skills.${dirName}.${field}`] = value;
		},
		onOpenSkillInEditor: (dirName: string) => {
			openSkillInEditor(dirName);
		},
		onDeleteSkill: (dirName: string) => {
			deleteSkill(dirName);
			for (const key of Object.keys(credentialValues)) {
				if (key.startsWith(`skills.${dirName}.`)) {
					delete credentialValues[key];
				}
			}
		},
		onUpdateRecordingField: (
			recordingId: string,
			field: "name" | "description",
			value: string,
		) => {
			const recording = findListenRecordingById(
				recordingId,
				listenRecordingsDir,
			);
			if (!recording) {
				throw new Error(`Recording not found: ${recordingId}`);
			}
			updateListenRecordingMetadata(recording, { [field]: value });
			credentialValues[`listen.recordings.${recordingId}.${field}`] = value;
		},
		onOpenRecordingInFinder: (recordingId: string) => {
			const recording = findListenRecordingById(
				recordingId,
				listenRecordingsDir,
			);
			if (!recording) {
				throw new Error(`Recording not found: ${recordingId}`);
			}
			openListenRecordingInFinder(recording);
		},
		onDeleteRecording: (recordingId: string) => {
			const recording = findListenRecordingById(
				recordingId,
				listenRecordingsDir,
			);
			if (!recording) {
				throw new Error(`Recording not found: ${recordingId}`);
			}
			deleteListenRecording(recording);
			for (const key of Object.keys(credentialValues)) {
				if (key.startsWith(`listen.recordings.${recordingId}.`)) {
					delete credentialValues[key];
				}
			}
		},
		onCreateSchedule: (): string => {
			const params: CreateScheduleParams = {
				name: "New schedule",
				prompt: "",
				personaName: getDefaultPersonaName() ?? "Toby",
				cronExpression: "0 9 * * *",
				enabled: true,
			};
			const created = createSchedule(params);
			seedScheduleValues(credentialValues);
			return created.id;
		},
		onUpdateScheduleField: (
			scheduleId: string,
			field: "name" | "prompt" | "personaName" | "cronExpression" | "enabled",
			value: string | boolean,
		) => {
			const schedule = findScheduleById(scheduleId);
			if (!schedule) throw new Error(`Schedule not found: ${scheduleId}`);
			if (field === "enabled") {
				updateSchedule(scheduleId, { enabled: Boolean(value) });
			} else if (field === "name") {
				updateSchedule(scheduleId, { name: String(value) });
			} else if (field === "prompt") {
				updateSchedule(scheduleId, { prompt: String(value) });
			} else if (field === "personaName") {
				updateSchedule(scheduleId, { personaName: String(value) });
			} else if (field === "cronExpression") {
				updateSchedule(scheduleId, { cronExpression: String(value) });
			}
			seedScheduleValues(credentialValues);
		},
		onDeleteSchedule: (scheduleId: string) => {
			deleteSchedule(scheduleId);
			seedScheduleValues(credentialValues);
		},
		onRunScheduleNow: async (scheduleId: string) => {
			const schedule = findScheduleById(scheduleId);
			if (!schedule) throw new Error(`Schedule not found: ${scheduleId}`);
			await executeSchedule(schedule);
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
			cfg.listen = rebuildListenConfig(values);
			applyIntegrationInboundFlags(cfg, values);
			writeConfig(cfg);
		},
		refreshTree,
		callbacks,
		listenRecordingsDir,
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

function rebuildListenConfig(values: Record<string, string>): ListenConfig {
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
