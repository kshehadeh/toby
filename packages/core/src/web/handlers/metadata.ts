import fs from "node:fs";
import { listUsableChatModules } from "../../chat-pipeline/resolve-chat-modules";
import { listPersonaOptions } from "../../chat-pipeline/turn-runtime";
import {
	getDefaultPersonaImagePath,
	resolvePersonaImagePath,
} from "../../config/index";
import { loadLocalSkills } from "../../skills/index";
import { jsonResponse } from "../http-utils";

export async function handlePersonasList(): Promise<Response> {
	const options = listPersonaOptions();
	const hasDefault = fs.existsSync(getDefaultPersonaImagePath());
	const personas = options.map((p) => ({
		...p,
		imageUrl: p.imagePath
			? `/api/personas/image/${encodeURIComponent(p.imagePath)}`
			: hasDefault
				? "/api/personas/image/default.png"
				: undefined,
	}));
	return jsonResponse({ personas });
}

export async function handleModulesList(): Promise<Response> {
	const modules = await listUsableChatModules();
	return jsonResponse({
		modules: modules.map((m) => ({
			name: m.name,
			displayName: m.displayName,
			connected: true,
		})),
	});
}

export function handleSkillsList(): Response {
	const skills = loadLocalSkills();
	return jsonResponse({
		skills: skills.map((s) => ({
			dirName: s.dirName,
			name: s.name,
			description: s.description,
		})),
	});
}

export function handleSkillDetail(dirName: string): Response {
	const skill = loadLocalSkills().find((s) => s.dirName === dirName);
	if (!skill) {
		return jsonResponse({ error: "Skill not found" }, 404);
	}
	return jsonResponse({
		skill: {
			dirName: skill.dirName,
			name: skill.name,
			description: skill.description,
			summary: skill.summary,
			bodyMarkdown: skill.bodyMarkdown,
			tools: skill.tools,
			integrations: skill.integrations,
		},
	});
}
