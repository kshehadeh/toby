import { listUsableChatModules } from "../../chat-pipeline/resolve-chat-modules";
import { listPersonaOptions } from "../../chat-pipeline/turn-runtime";
import { loadLocalSkills } from "../../skills/index";
import { jsonResponse } from "../http-utils";

export async function handlePersonasList(): Promise<Response> {
	return jsonResponse({ personas: listPersonaOptions() });
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
