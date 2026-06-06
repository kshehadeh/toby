import { getAIProviders } from "@toby/core/ai/providers";
import {
	clearDefaultPersona,
	getDefaultPersonaName,
	readConfig,
	setDefaultPersona,
	writeConfig,
} from "@toby/core/config/index";
import {
	rebuildDefaultProviders,
	rebuildPersonas,
	saveConfigureValues,
	seedConfigureValues,
	seedScheduleValues,
} from "@toby/core/configure/persistence";
import { DEFAULT_CHAT_PERSONA } from "@toby/core/personas/index";
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
import { listListenRecordings } from "../../listen/session-controller";
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
	const credentialValues = seedConfigureValues({
		listenRecordings: listListenRecordings(listenRecordingsDir),
	});

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
			getAIProviders(),
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
			saveConfigureValues(values);
		},
		refreshTree,
		callbacks,
		listenRecordingsDir,
	};
}
