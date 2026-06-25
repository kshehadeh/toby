import fs from "node:fs";
import { AI_PROVIDERS } from "../../ai/providers";
import { listUsableChatModules } from "../../chat-pipeline/resolve-chat-modules";
import { listPersonaOptions } from "../../chat-pipeline/turn-runtime";
import {
	getDefaultPersonaImagePath,
	getDefaultPersonaName,
	resolvePersonaImagePath,
} from "../../config/index";
import { DEFAULT_CHAT_PERSONA, listPersonas } from "../../personas/index";
import { loadLocalSkills } from "../../skills/index";
import { jsonResponse } from "../http-utils";

export async function handlePersonasList(): Promise<Response> {
	const options = listPersonaOptions();
	const hasDefault = fs.existsSync(getDefaultPersonaImagePath());
	const defaultName = getDefaultPersonaName();
	const personas = options.map((p) => ({
		...p,
		imageUrl: p.imagePath
			? `/api/personas/image/${encodeURIComponent(p.imagePath)}`
			: hasDefault
				? "/api/personas/image/default.png"
				: undefined,
		isDefault: p.name === defaultName,
		isBuiltIn: p.name === DEFAULT_CHAT_PERSONA.name,
	}));
	return jsonResponse({ personas });
}

export async function handlePersonaDetail(name: string): Promise<Response> {
	const decoded = decodeURIComponent(name);
	const all = listPersonas();
	const persona = all.find((p) => p.name === decoded);
	if (!persona) {
		return jsonResponse({ error: "Persona not found" }, 404);
	}
	const hasDefault = fs.existsSync(getDefaultPersonaImagePath());
	const isBuiltIn = persona.name === DEFAULT_CHAT_PERSONA.name;
	return jsonResponse({
		persona: {
			name: persona.name,
			label: persona.name,
			instructions: persona.instructions,
			promptMode: persona.promptMode,
			provider: persona.ai.provider,
			model: persona.ai.model,
			imagePath: persona.imagePath,
			imageUrl: persona.imagePath
				? `/api/personas/image/${encodeURIComponent(persona.imagePath)}`
				: hasDefault
					? "/api/personas/image/default.png"
					: undefined,
			isBuiltIn,
			isDefault: persona.name === getDefaultPersonaName(),
		},
	});
}

export function handleAIProviders(): Response {
	return jsonResponse({
		providers: AI_PROVIDERS.map((p) => ({
			id: p.id,
			displayName: p.displayName,
			models: p.models,
			allowCustomModel: p.allowCustomModel ?? false,
		})),
	});
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
