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
			name: s.name,
			description: s.description,
		})),
	});
}
