import fs from "node:fs";
import path from "node:path";
import { isAIProviderConfigured } from "../../ai/model-factory";
import {
	clearModelListCache,
	resolveAIProvidersForUI,
} from "../../ai/model-list";
import {
	clearPlanUsageCache,
	fetchAIProviderPlanUsage,
	fetchAllAIProviderPlanUsage,
} from "../../ai/plan-usage";
import {
	getProviderSetupAdapter,
	hasProviderSetupAdapter,
} from "../../ai/provider-setup";
import { listUsableChatModules } from "../../chat-pipeline/resolve-chat-modules";
import { listPersonaOptions } from "../../chat-pipeline/turn-runtime";
import {
	getDefaultPersonaImagePath,
	getDefaultPersonaName,
	resolvePersonaImagePath,
} from "../../config/index";
import { invalidateSettingsCache } from "../../configure/settings-cache";
import { DEFAULT_CHAT_PERSONA, listPersonas } from "../../personas/index";
import { loadLocalSkills } from "../../skills/index";
import { resolveSkillIconPath } from "../../skills/manage";
import { errorResponse, jsonResponse, readJsonBody } from "../http-utils";

const ICON_CONTENT_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
};

function skillIconUrl(dirName: string): string | undefined {
	return resolveSkillIconPath(dirName)
		? `/api/skills/${encodeURIComponent(dirName)}/icon`
		: undefined;
}

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

export async function handleAIProviders(): Promise<Response> {
	const providers = await resolveAIProvidersForUI();
	return jsonResponse({
		providers: providers.map((p) => ({
			id: p.id,
			displayName: p.displayName,
			models: p.models,
			allowCustomModel: p.allowCustomModel ?? false,
			configured: isAIProviderConfigured(p.id),
			/** True when GET/POST `/api/ai/providers/:id/setup` is implemented. */
			supportsGuidedSetup: hasProviderSetupAdapter(p.id),
		})),
	});
}

export async function handleAIProviderUsageAll(): Promise<Response> {
	const usage = await fetchAllAIProviderPlanUsage();
	return jsonResponse({
		usage: usage.map((u) => ({
			providerId: u.providerId,
			supported: u.supported,
			currency: u.currency,
			totalSpent: u.totalSpent,
			remaining: u.remaining,
			totalSpentLabel: u.totalSpentLabel,
			remainingLabel: u.remainingLabel,
			unavailableReason: u.unavailableReason,
			fetchedAt: u.fetchedAt,
		})),
	});
}

export async function handleAIProviderUsage(
	providerId: string,
): Promise<Response> {
	clearPlanUsageCache(providerId);
	const usage = await fetchAIProviderPlanUsage(providerId);
	return jsonResponse({
		usage: {
			providerId: usage.providerId,
			supported: usage.supported,
			currency: usage.currency,
			totalSpent: usage.totalSpent,
			remaining: usage.remaining,
			totalSpentLabel: usage.totalSpentLabel,
			remainingLabel: usage.remainingLabel,
			unavailableReason: usage.unavailableReason,
			fetchedAt: usage.fetchedAt,
		},
	});
}

/**
 * Guided setup guide for any provider that registered a setup adapter.
 * `GET /api/ai/providers/:providerId/setup`
 */
export async function handleAIProviderSetupGuide(
	providerId: string,
): Promise<Response> {
	const adapter = getProviderSetupAdapter(providerId);
	if (!adapter) {
		return errorResponse(
			`Provider "${providerId}" does not support guided setup`,
			404,
		);
	}
	const guide = await adapter.getGuide();
	return jsonResponse(guide);
}

/**
 * Complete guided setup for a provider.
 * `POST /api/ai/providers/:providerId/setup`
 *
 * Body (open-ended):
 * ```json
 * { "fields": { "apiKey": "…" }, "model": "optional-slug" }
 * ```
 * Flat legacy body `{ apiKey, model? }` is also accepted and folded into `fields`.
 */
export async function handleAIProviderSetup(
	providerId: string,
	req: Request,
): Promise<Response> {
	const adapter = getProviderSetupAdapter(providerId);
	if (!adapter) {
		return errorResponse(
			`Provider "${providerId}" does not support guided setup`,
			404,
		);
	}

	const body = await readJsonBody<Record<string, unknown>>(req);
	const fields = normalizeSetupFields(body);
	const model = typeof body?.model === "string" ? body.model : undefined;

	try {
		const result = await adapter.setup({ fields, model });
		if (!result.ok) {
			return errorResponse(result.error, result.status ?? 400);
		}

		invalidateSettingsCache();
		clearModelListCache(providerId);
		clearPlanUsageCache(providerId);

		return jsonResponse({
			ok: true,
			providerId: result.providerId,
			model: result.model,
			personaName: result.personaName,
			configured: isAIProviderConfigured(providerId),
			details: result.details ?? {},
			// Convenience flat mirrors for common detail keys (optional).
			remaining:
				typeof result.details?.remaining === "number"
					? result.details.remaining
					: undefined,
			totalSpent:
				typeof result.details?.totalSpent === "number"
					? result.details.totalSpent
					: undefined,
		});
	} catch (e) {
		return errorResponse(e instanceof Error ? e.message : String(e), 500);
	}
}

/**
 * Accept either `{ fields: Record<string, string> }` or a flat map of string
 * values (excluding `model`) so clients can stay simple.
 */
function normalizeSetupFields(
	body: Record<string, unknown> | null | undefined,
): Record<string, string> {
	if (!body) return {};
	const nested = body.fields;
	if (nested && typeof nested === "object" && !Array.isArray(nested)) {
		const out: Record<string, string> = {};
		for (const [key, value] of Object.entries(
			nested as Record<string, unknown>,
		)) {
			if (typeof value === "string") {
				out[key] = value;
			}
		}
		return out;
	}
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(body)) {
		if (key === "model" || key === "fields") continue;
		if (typeof value === "string") {
			out[key] = value;
		}
	}
	return out;
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
			summary: s.summary ?? "",
			enabled: s.enabled ?? true,
			iconUrl: skillIconUrl(s.dirName),
			createdAt: s.createdAt,
			updatedAt: s.updatedAt,
		})),
	});
}

export function handleSkillIcon(dirName: string): Response {
	const iconPath = resolveSkillIconPath(dirName);
	if (!iconPath) {
		return errorResponse("Skill icon not found", 404);
	}
	let bytes: Buffer;
	let stat: fs.Stats;
	try {
		stat = fs.statSync(iconPath);
		bytes = fs.readFileSync(iconPath);
	} catch {
		return errorResponse("Skill icon not found", 404);
	}
	const ext = path.extname(iconPath).toLowerCase();
	const contentType = ICON_CONTENT_TYPES[ext] ?? "application/octet-stream";
	const body = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(body).set(bytes);
	return new Response(body, {
		headers: {
			"Content-Type": contentType,
			"Content-Length": String(bytes.byteLength),
			"Cache-Control": "no-cache",
			"Last-Modified": stat.mtime.toUTCString(),
		},
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
			summary: skill.summary ?? "",
			enabled: skill.enabled ?? true,
			iconUrl: skillIconUrl(skill.dirName),
			createdAt: skill.createdAt,
			updatedAt: skill.updatedAt,
			bodyMarkdown: skill.bodyMarkdown,
			tools: skill.tools,
			integrations: skill.integrations,
		},
	});
}
