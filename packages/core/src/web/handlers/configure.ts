import { AI_PROVIDERS } from "../../ai/providers";
import {
	clearDefaultPersona,
	getDefaultPersonaName,
	readConfig,
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
import { getIntegrationModules } from "../../integrations/index";
import { DEFAULT_CHAT_PERSONA } from "../../personas/index";
import {
	createSchedule,
	deleteSchedule,
	updateSchedule,
} from "../../schedules/store";
import { deleteSkill, updateSkillFrontmatter } from "../../skills/manage";
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
			const name = `Persona ${cfg.personas.length + 1}`;
			cfg.personas.push({
				name,
				instructions: DEFAULT_CHAT_PERSONA.instructions,
				promptMode: DEFAULT_CHAT_PERSONA.promptMode,
				ai: { ...DEFAULT_CHAT_PERSONA.ai },
			});
			writeConfig(cfg);
			return jsonResponse({ ok: true, personaName: name });
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
		default:
			return errorResponse(`Unknown action: ${action}`, 404);
	}
}
