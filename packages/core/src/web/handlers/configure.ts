import fs from "node:fs";
import path from "node:path";
import { AI_PROVIDERS } from "../../ai/providers";
import {
	clearDefaultPersona,
	ensurePersonaImagesDir,
	getDefaultPersonaName,
	readConfig,
	resolvePersonaImagePath,
	setDefaultPersona,
	writeConfig,
} from "../../config/index";
import {
	applyConfigureValuesPatch,
	redactConfigureValues,
	seedConfigureValues,
} from "../../configure/persistence";
import { buildSettingsTree } from "../../configure/tree";
import type { SettingsItem } from "../../configure/types";
import {
	getIntegrationModules,
	resetPluginModuleCache,
} from "../../integrations/index";
import { daemonLog } from "../../logging/daemon-log";
import { DEFAULT_CHAT_PERSONA } from "../../personas/index";
import { humanToCronAsync } from "../../schedules/cron-parser";
import {
	createScheduleRunForExecution,
	executeScheduleRun,
} from "../../schedules/executor";
import {
	createSchedule,
	deleteSchedule,
	getScheduleRun,
	listSchedules,
	updateSchedule,
} from "../../schedules/store";
import {
	createSkill,
	deleteSkill,
	updateSkillBody,
	updateSkillFrontmatter,
} from "../../skills/manage";
import { errorResponse, jsonResponse, readJsonBody } from "../http-utils";

function annotateTreeSecrets(node: SettingsItem): SettingsItem {
	// Masked/secret value fields are now editable from the web UI (rendered as
	// password inputs) and persisted to the credentials file. Only structural
	// nodes stay read-only.
	const readOnly =
		node.kind === "hint" || node.kind === "action" || node.kind === "delete";
	const children = node.children?.map(annotateTreeSecrets);
	return {
		...node,
		readOnly,
		children,
	};
}

function buildIntegrationLabels(): Record<string, string> {
	const labels: Record<string, string> = { "(none)": "None" };
	for (const mod of getIntegrationModules()) {
		labels[mod.name] = mod.displayName;
	}
	return labels;
}

export function handleConfigureTree(): Response {
	// Reset the plugin module cache so newly installed/removed plugins are
	// reflected without requiring a daemon restart.
	resetPluginModuleCache();
	const values = seedConfigureValues();
	const redacted = redactConfigureValues(values);
	const config = readConfig();
	const personas = config.personas.some(
		(p) => p.name === DEFAULT_CHAT_PERSONA.name,
	)
		? config.personas
		: [DEFAULT_CHAT_PERSONA, ...config.personas];
	const tree = buildSettingsTree(
		personas,
		AI_PROVIDERS,
		redacted,
		config.defaultProviders,
		{ daemonRunning: true },
	);
	return jsonResponse({
		tree: annotateTreeSecrets(tree),
		values: redacted,
		integrationLabels: buildIntegrationLabels(),
	});
}

const SETTINGS_SECTION_KEYS = ["chatInbound", "defaults", "ai", "projects"];

function stripToSectionNodes(node: SettingsItem): SettingsItem {
	const sectionChildren = (node.children ?? [])
		.filter((child) => child.kind === "section")
		.map(stripToSectionNodes);
	return {
		...node,
		children: sectionChildren,
	};
}

function findSectionByKey(
	node: SettingsItem,
	key: string,
): SettingsItem | null {
	if (node.key === key) return node;
	for (const child of node.children ?? []) {
		if (child.kind === "section") {
			const found = findSectionByKey(child, key);
			if (found) return found;
		}
	}
	return null;
}

export function handleConfigureSections(): Response {
	resetPluginModuleCache();
	const values = seedConfigureValues();
	const redacted = redactConfigureValues(values);
	const config = readConfig();
	const personas = config.personas.some(
		(p) => p.name === DEFAULT_CHAT_PERSONA.name,
	)
		? config.personas
		: [DEFAULT_CHAT_PERSONA, ...config.personas];
	const tree = buildSettingsTree(
		personas,
		AI_PROVIDERS,
		redacted,
		config.defaultProviders,
		{ daemonRunning: true },
	);
	const sectionMap = new Map(
		(tree.children ?? []).map((child) => [child.key, child]),
	);
	const sections = SETTINGS_SECTION_KEYS.map((key) => sectionMap.get(key))
		.filter((s): s is SettingsItem => s != null)
		.map(stripToSectionNodes);
	return jsonResponse({ sections });
}

export function handleConfigureSectionDetail(sectionKey: string): Response {
	resetPluginModuleCache();
	const values = seedConfigureValues();
	const redacted = redactConfigureValues(values);
	const config = readConfig();
	const personas = config.personas.some(
		(p) => p.name === DEFAULT_CHAT_PERSONA.name,
	)
		? config.personas
		: [DEFAULT_CHAT_PERSONA, ...config.personas];
	const tree = buildSettingsTree(
		personas,
		AI_PROVIDERS,
		redacted,
		config.defaultProviders,
		{ daemonRunning: true },
	);
	const section = findSectionByKey(tree, sectionKey);
	if (!section) {
		return errorResponse(`Section "${sectionKey}" not found`, 404);
	}
	return jsonResponse({
		section: annotateTreeSecrets(section),
		values: redacted,
		integrationLabels: buildIntegrationLabels(),
	});
}

export async function handleConfigurePatch(req: Request): Promise<Response> {
	const body = await readJsonBody<{ changes?: Record<string, string> }>(req);
	if (!body?.changes || typeof body.changes !== "object") {
		return errorResponse("Expected { changes: Record<string, string> }");
	}
	try {
		applyConfigureValuesPatch(body.changes);
		return handleConfigureTree();
	} catch (e) {
		return errorResponse(e instanceof Error ? e.message : String(e), 403);
	}
}

export async function handleConfigureAction(
	action: string,
	req: Request,
): Promise<Response> {
	const body = await readJsonBody<Record<string, string>>(req);

	switch (action) {
		case "create-persona": {
			const cfg = readConfig();
			const requestedName = body?.name?.trim();
			const name = requestedName || `Persona ${cfg.personas.length + 1}`;
			if (name === DEFAULT_CHAT_PERSONA.name) {
				return errorResponse(`"${name}" is a reserved persona name`);
			}
			if (cfg.personas.some((p) => p.name === name)) {
				return errorResponse(`Persona "${name}" already exists`);
			}
			const provider =
				body?.provider?.trim() || DEFAULT_CHAT_PERSONA.ai.provider;
			const model = body?.model?.trim() || DEFAULT_CHAT_PERSONA.ai.model;
			const promptMode =
				body?.promptMode?.trim() === "replace" ? "replace" : "add";
			const instructions =
				body?.instructions ?? DEFAULT_CHAT_PERSONA.instructions;
			cfg.personas.push({
				name,
				instructions,
				promptMode,
				ai: { provider, model },
			});
			writeConfig(cfg);
			return jsonResponse({ ok: true, personaName: name });
		}
		case "update-persona": {
			const originalName = body?.originalName?.trim();
			if (!originalName) return errorResponse("originalName required");
			if (originalName === DEFAULT_CHAT_PERSONA.name) {
				return errorResponse("The built-in default persona cannot be edited");
			}
			const cfg = readConfig();
			const persona = cfg.personas.find((p) => p.name === originalName);
			if (!persona) {
				return errorResponse(`Persona "${originalName}" not found`);
			}
			const newName = body?.name?.trim();
			if (newName && newName !== originalName) {
				if (newName === DEFAULT_CHAT_PERSONA.name) {
					return errorResponse(`"${newName}" is a reserved persona name`);
				}
				if (cfg.personas.some((p) => p.name === newName)) {
					return errorResponse(`Persona "${newName}" already exists`);
				}
				persona.name = newName;
				if (cfg.defaultPersona === originalName) {
					cfg.defaultPersona = newName;
				}
			}
			if (body?.instructions !== undefined) {
				persona.instructions = body.instructions;
			}
			if (body?.promptMode !== undefined) {
				persona.promptMode =
					body.promptMode.trim() === "replace" ? "replace" : "add";
			}
			if (body?.provider !== undefined) {
				persona.ai.provider = body.provider.trim() || persona.ai.provider;
			}
			if (body?.model !== undefined) {
				persona.ai.model = body.model.trim() || persona.ai.model;
			}
			writeConfig(cfg);
			return jsonResponse({ ok: true, personaName: persona.name });
		}
		case "delete-persona": {
			const personaName = body?.personaName?.trim();
			if (!personaName || personaName === DEFAULT_CHAT_PERSONA.name) {
				return errorResponse("Invalid persona name");
			}
			const cfg = readConfig();
			cfg.personas = cfg.personas.filter((p) => p.name !== personaName);
			if (cfg.defaultPersona === personaName) {
				cfg.defaultPersona = undefined;
			}
			writeConfig(cfg);
			return jsonResponse({ ok: true });
		}
		case "set-default-persona": {
			const personaName = body?.personaName?.trim();
			if (!personaName) return errorResponse("personaName required");
			setDefaultPersona(personaName);
			return jsonResponse({ ok: true });
		}
		case "clear-default-persona": {
			clearDefaultPersona();
			return jsonResponse({ ok: true });
		}
		case "upload-persona-image": {
			const personaName = body?.personaName?.trim();
			const imageBase64 = body?.imageBase64?.trim();
			const filename = body?.filename?.trim();
			if (!personaName) return errorResponse("personaName required");
			if (!imageBase64) return errorResponse("imageBase64 required");

			const cfg = readConfig();
			const persona = cfg.personas.find((p) => p.name === personaName);
			if (!persona) return errorResponse(`Persona "${personaName}" not found`);

			ensurePersonaImagesDir();
			const ext = filename
				? path.extname(filename).toLowerCase() || ".png"
				: ".png";
			const safeName = personaName.replace(/[^a-zA-Z0-9_-]/g, "_");
			const imageFilename = `${safeName}-${Date.now()}${ext}`;
			const destPath = resolvePersonaImagePath(imageFilename);
			const buffer = Buffer.from(imageBase64, "base64");
			fs.writeFileSync(destPath, buffer);

			// Remove old image if it existed
			if (persona.imagePath) {
				const oldPath = resolvePersonaImagePath(persona.imagePath);
				if (fs.existsSync(oldPath)) {
					try {
						fs.unlinkSync(oldPath);
					} catch {
						// ignore cleanup errors
					}
				}
			}

			persona.imagePath = imageFilename;
			writeConfig(cfg);
			return jsonResponse({ ok: true, imagePath: imageFilename });
		}
		case "reset-persona-image": {
			const personaName = body?.personaName?.trim();
			if (!personaName) return errorResponse("personaName required");

			const cfg = readConfig();
			const persona = cfg.personas.find((p) => p.name === personaName);
			if (!persona) return errorResponse(`Persona "${personaName}" not found`);

			if (persona.imagePath) {
				const oldPath = resolvePersonaImagePath(persona.imagePath);
				if (fs.existsSync(oldPath)) {
					try {
						fs.unlinkSync(oldPath);
					} catch {
						// ignore cleanup errors
					}
				}
				persona.imagePath = undefined;
				writeConfig(cfg);
			}
			return jsonResponse({ ok: true });
		}
		case "update-skill-field": {
			const dirName = body?.dirName?.trim();
			const field = body?.field as
				| "name"
				| "description"
				| "summary"
				| undefined;
			const value = body?.value ?? "";
			if (!dirName || !field)
				return errorResponse("dirName and field required");
			updateSkillFrontmatter(dirName, { [field]: value });
			return jsonResponse({ ok: true });
		}
		case "delete-skill": {
			const dirName = body?.dirName?.trim();
			if (!dirName) return errorResponse("dirName required");
			deleteSkill(dirName);
			return jsonResponse({ ok: true });
		}
		case "create-skill": {
			const created = createSkill();
			return jsonResponse({ ok: true, dirName: created.dirName });
		}
		case "update-skill-body": {
			const dirName = body?.dirName?.trim();
			const bodyMarkdown = body?.body ?? "";
			if (!dirName) return errorResponse("dirName required");
			updateSkillBody(dirName, bodyMarkdown);
			return jsonResponse({ ok: true });
		}
		case "create-schedule": {
			const created = createSchedule({
				name: "New schedule",
				prompt: "",
				personaName: getDefaultPersonaName() ?? "Toby",
				cronExpression: "0 9 * * *",
				enabled: true,
			});
			return jsonResponse({ ok: true, scheduleId: created.id });
		}
		case "update-schedule-field": {
			const scheduleId = body?.scheduleId?.trim();
			const field = body?.field?.trim();
			const value = body?.value;
			if (!scheduleId || !field) {
				return errorResponse("scheduleId and field required");
			}
			if (field === "enabled") {
				updateSchedule(scheduleId, {
					enabled: value === "Yes" || value === "true",
				});
			} else if (field === "name") {
				updateSchedule(scheduleId, { name: String(value ?? "") });
			} else if (field === "prompt") {
				updateSchedule(scheduleId, { prompt: String(value ?? "") });
			} else if (field === "persona") {
				updateSchedule(scheduleId, { personaName: String(value ?? "") });
			} else if (field === "cron") {
				updateSchedule(scheduleId, { cronExpression: String(value ?? "") });
			} else {
				return errorResponse(`Unknown schedule field: ${field}`);
			}
			return jsonResponse({ ok: true });
		}
		case "delete-schedule": {
			const scheduleId = body?.scheduleId?.trim();
			if (!scheduleId) return errorResponse("scheduleId required");
			deleteSchedule(scheduleId);
			return jsonResponse({ ok: true });
		}
		case "run-schedule": {
			const scheduleId = body?.scheduleId?.trim();
			if (!scheduleId) return errorResponse("scheduleId required");
			const schedule = listSchedules().find((s) => s.id === scheduleId);
			if (!schedule) return errorResponse("Schedule not found", 404);
			if (!schedule.enabled) return errorResponse("Schedule is disabled");
			// Create the run record synchronously so the UI can open its detail view,
			// then execute in the background so the HTTP request returns quickly.
			const runId = createScheduleRunForExecution(schedule);
			Promise.resolve().then(async () => {
				try {
					await executeScheduleRun(runId, schedule);
				} catch (e) {
					daemonLog("error", "daemon", "run_schedule_failed", {
						scheduleId,
						runId,
						error: e instanceof Error ? e.message : String(e),
					});
				}
			});
			return jsonResponse({ ok: true, queued: true, runId });
		}
		default:
			return errorResponse(`Unknown action: ${action}`, 404);
	}
}

export function handleScheduleRunDetail(runId: string): Response {
	const run = getScheduleRun(runId);
	if (!run) return errorResponse("Schedule run not found", 404);
	const schedule = listSchedules().find((s) => s.id === run.scheduleId);
	let transcript: unknown[] = [];
	if (run.transcript) {
		try {
			transcript = JSON.parse(run.transcript) as unknown[];
		} catch {
			transcript = [];
		}
	}
	return jsonResponse({
		run: {
			id: run.id,
			scheduleId: run.scheduleId,
			scheduleName: schedule?.name ?? run.scheduleId,
			personaName: run.personaName,
			prompt: run.prompt,
			output: run.output,
			status: run.status,
			error: run.error,
			startedAt: run.startedAt,
			completedAt: run.completedAt,
			transcript,
		},
	});
}

export async function handleParseCron(req: Request): Promise<Response> {
	const body = await readJsonBody<{ input?: string }>(req);
	const input = body?.input?.trim();
	if (!input) {
		return errorResponse("input is required");
	}
	try {
		const cronExpression = await humanToCronAsync(input);
		return jsonResponse({ cronExpression });
	} catch (e) {
		return errorResponse(e instanceof Error ? e.message : String(e), 400);
	}
}
