import {
	isIntegrationUsableInChat,
	sortModulesByName,
} from "../chat-integrations";
import { getDefaultProvider } from "../config/index";
import { getModulesWithCapability } from "../integrations/index";
import {
	type IntegrationModule,
	PROVIDER_CATEGORY_LABELS,
	type ProviderCategory,
} from "../integrations/types";

const CATEGORY_KEYWORDS: Record<ProviderCategory, string[]> = {
	email: [
		"email",
		"e-mail",
		"mail",
		"inbox",
		"send",
		"compose",
		"draft",
		"reply",
		"forward",
		"gmail",
		"outlook",
	],
	calendar: [
		"calendar",
		"event",
		"meeting",
		"schedule",
		"appointment",
		"reminder",
		"ical",
	],
	tasks: [
		"task",
		"todo",
		"to-do",
		"to do",
		"todoist",
		"checklist",
		"assignment",
	],
	contacts: [
		"contact",
		"address book",
		"directory",
		"people",
		"colleague",
		"coworker",
	],
	chat: [
		"slack",
		"channel",
		"channels",
		"dm",
		"dms",
		"direct message",
		"workspace",
		"thread",
		"post",
		"message",
		"chat",
	],
	search: [
		"search",
		"find",
		"look up",
		"lookup",
		"google",
		"brave",
		"web search",
		"research",
	],
	work_tracker: [
		"jira",
		"issue",
		"ticket",
		"bug",
		"backlog",
		"sprint",
		"epic",
		"board",
		"tracker",
		"work tracker",
		"project management",
	],
	transcription: [
		"transcribe",
		"transcription",
		"transcript",
		"whisper",
		"speech",
		"dictation",
		"listen",
	],
};

export function inferProviderCategoriesFromPrompt(
	prompt: string,
): ProviderCategory[] {
	const lower = prompt.toLowerCase();
	const matched: ProviderCategory[] = [];
	for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
		if (keywords.some((kw) => lower.includes(kw))) {
			matched.push(cat as ProviderCategory);
		}
	}
	return matched;
}

/**
 * Pick chat-capable integrations for a prompt (schedules, inbound, etc.).
 * When no category keywords match, all connected chat modules are used.
 */
export function resolveChatModulesForPrompt(
	prompt: string,
	chatModules: readonly IntegrationModule[],
): { modules: IntegrationModule[]; warnings: string[] } {
	const neededCategories = inferProviderCategoriesFromPrompt(prompt);

	if (neededCategories.length === 0) {
		return { modules: [...chatModules], warnings: [] };
	}

	const warnings: string[] = [];
	const selectedNames = new Set<string>();

	for (const cat of neededCategories) {
		const defaultName = getDefaultProvider(cat);
		if (defaultName) {
			const mod = chatModules.find((m) => m.name === defaultName);
			if (mod) {
				selectedNames.add(mod.name);
			} else {
				warnings.push(
					`Default ${PROVIDER_CATEGORY_LABELS[cat]} is set to "${defaultName}" but it is not available (not connected or not chat-capable). No ${cat} tools will be available for this run.`,
				);
			}
		} else {
			const catModules = chatModules.filter((m) =>
				m.providerCategories?.includes(cat),
			);
			if (catModules.length === 0) {
				warnings.push(
					`No default ${PROVIDER_CATEGORY_LABELS[cat]} is configured and no connected ${cat} integration is available. Set a default provider via \`toby configure\` to use ${cat} tools.`,
				);
			} else if (catModules.length === 1) {
				const only = catModules[0];
				if (only) {
					selectedNames.add(only.name);
				}
			} else {
				for (const m of catModules) {
					selectedNames.add(m.name);
				}
				warnings.push(
					`No default ${PROVIDER_CATEGORY_LABELS[cat]} is configured, but multiple ${cat} integrations are connected (${catModules.map((m) => m.displayName).join(", ")}). All will be included. Set a default via \`toby configure\` to choose one.`,
				);
			}
		}
	}

	for (const m of chatModules) {
		if (!m.providerCategories || m.providerCategories.length === 0) {
			selectedNames.add(m.name);
		}
	}

	const modules = chatModules.filter((m) => selectedNames.has(m.name));
	return { modules, warnings };
}

export async function listUsableChatModules(): Promise<IntegrationModule[]> {
	const chatMods = getModulesWithCapability("chat").filter((m) => m.chat);
	const usable: IntegrationModule[] = [];
	for (const m of chatMods) {
		if (await isIntegrationUsableInChat(m)) {
			usable.push(m);
		}
	}
	return sortModulesByName(usable);
}

/** Web/native app turns: prompt-scoped modules from connected chat integrations. */
export async function resolveWebChatModules(
	userText: string,
): Promise<{ modules: IntegrationModule[]; warnings: string[] }> {
	const usable = await listUsableChatModules();
	return resolveChatModulesForPrompt(userText, usable);
}

/** Inbound turns: prompt-scoped modules plus the transport (e.g. slack). */
export async function resolveHeadlessChatModules(
	userText: string,
	inboundModule: IntegrationModule,
): Promise<{ modules: IntegrationModule[]; warnings: string[] }> {
	const usable = await listUsableChatModules();
	const { modules, warnings } = resolveChatModulesForPrompt(userText, usable);
	const names = new Set(modules.map((m) => m.name));
	names.add(inboundModule.name);
	const merged = usable.filter((m) => names.has(m.name));
	if (!names.has(inboundModule.name) && inboundModule.chat) {
		merged.push(inboundModule);
	}
	return { modules: sortModulesByName(merged), warnings };
}
