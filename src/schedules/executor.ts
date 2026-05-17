import type { CoreMessage } from "../ai/chat";
import { chatWithTools, createModelForPersona } from "../ai/chat";
import { getDefaultProvider } from "../config/index";
import type { Persona } from "../config/index";
import {
	getModulesForCategory,
	getModulesWithCapability,
} from "../integrations/index";
import {
	ALL_PROVIDER_CATEGORIES,
	type IntegrationModule,
	PROVIDER_CATEGORY_LABELS,
	type ProviderCategory,
} from "../integrations/types";
import { resolvePersona } from "../personas/index";
import { prepareChatSessionMessages } from "../ui/chat/prepare-messages";
import {
	completeScheduleRun,
	createScheduleRun,
	updateScheduleLastRun,
} from "./store";
import type { Schedule } from "./types";

const SCHEDULE_SYSTEM_INSTRUCTION_APPENDIX = `

---

## Scheduled run policy

This is an automated scheduled run. You **must not** ask questions or wait for user input. There is no interactive user available. Complete the task using your best judgment. If something is ambiguous, make a reasonable assumption and proceed. Do not call the askUser tool — it is not available in this context.
`;

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
};

function inferProviderCategoriesFromPrompt(prompt: string): ProviderCategory[] {
	const lower = prompt.toLowerCase();
	const matched: ProviderCategory[] = [];
	for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
		if (keywords.some((kw) => lower.includes(kw))) {
			matched.push(cat as ProviderCategory);
		}
	}
	return matched;
}

function resolveModulesForSchedule(
	prompt: string,
	chatModules: IntegrationModule[],
): { modules: IntegrationModule[]; warnings: string[] } {
	const neededCategories = inferProviderCategoriesFromPrompt(prompt);

	if (neededCategories.length === 0) {
		return { modules: chatModules, warnings: [] };
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
			const catModules = getModulesForCategory(cat).filter((m) =>
				chatModules.some((cm) => cm.name === m.name),
			);
			if (catModules.length === 0) {
				warnings.push(
					`No default ${PROVIDER_CATEGORY_LABELS[cat]} is configured and no connected ${cat} integration is available. Set a default provider via \`toby configure\` to use ${cat} tools in scheduled runs.`,
				);
			} else if (catModules.length === 1) {
				selectedNames.add(catModules[0].name);
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

	// Always include modules that have no provider categories (utility integrations)
	for (const m of chatModules) {
		if (!m.providerCategories || m.providerCategories.length === 0) {
			selectedNames.add(m.name);
		}
	}

	const modules = chatModules.filter((m) => selectedNames.has(m.name));
	return { modules, warnings };
}

export async function executeSchedule(schedule: Schedule): Promise<void> {
	const persona = resolvePersona(schedule.personaName);
	if (!persona) {
		throw new Error(
			`Schedule "${schedule.name}": persona "${schedule.personaName}" not found`,
		);
	}

	const allChatModules = getModulesWithCapability("chat").filter((m) => m.chat);
	if (allChatModules.length === 0) {
		throw new Error(
			`Schedule "${schedule.name}": no chat-capable integrations available`,
		);
	}

	const { modules: chatModules, warnings } = resolveModulesForSchedule(
		schedule.prompt,
		allChatModules,
	);

	const runId = createScheduleRun({
		scheduleId: schedule.id,
		personaName: schedule.personaName,
		prompt: schedule.prompt,
	});

	// If there are blocking warnings (needed category has no provider at all), short-circuit
	const blockingCategories = inferProviderCategoriesFromPrompt(
		schedule.prompt,
	).filter((cat) => {
		const defaultName = getDefaultProvider(cat);
		if (defaultName) {
			return !chatModules.some((m) => m.name === defaultName);
		}
		const catModules = getModulesForCategory(cat).filter((m) =>
			allChatModules.some((cm) => cm.name === m.name),
		);
		return catModules.length === 0;
	});

	if (blockingCategories.length > 0) {
		const details = blockingCategories
			.map(
				(cat) =>
					`${PROVIDER_CATEGORY_LABELS[cat]}: no default provider configured and no connected integration available. Run \`toby configure\` to set a default ${cat} provider.`,
			)
			.join("; ");
		completeScheduleRun(runId, {
			status: "error",
			error: `Cannot execute schedule "${schedule.name}": ${details}`,
		});
		updateScheduleLastRun(schedule.id);
		return;
	}

	try {
		const warningPrefix =
			warnings.length > 0
				? `[Schedule warnings: ${warnings.join(" | ")}]\n\n`
				: "";

		const augmentedPersona: Persona = {
			...persona,
			instructions: persona.instructions + SCHEDULE_SYSTEM_INSTRUCTION_APPENDIX,
		};

		const messages = await prepareChatSessionMessages(
			chatModules,
			augmentedPersona,
			schedule.prompt,
		);

		const toolBundles = await Promise.all(
			chatModules.map(async (m) => {
				if (!m.createChatTools) return null;
				return await m.createChatTools({ dryRun: false });
			}),
		);

		const mergedTools: Record<string, import("ai").Tool> = {};
		for (const bundle of toolBundles) {
			if (!bundle) continue;
			Object.assign(mergedTools, bundle.tools);
		}

		// Add global and memory tools (same as runSharedChatTurn)
		const { createGlobalChatTools } = await import("../ai/global-chat-tools");
		const globalApplied: string[] = [];
		Object.assign(
			mergedTools,
			createGlobalChatTools({
				dryRun: false,
				persona: augmentedPersona,
				appliedActions: globalApplied,
			}),
		);

		const { createMemoryTools } = await import("../memory/tools");
		const memoryApplied: string[] = [];
		Object.assign(
			mergedTools,
			createMemoryTools({
				userId: "default",
				dryRun: false,
				appliedActions: memoryApplied,
			}),
		);

		// Do NOT add askUser tool — scheduled runs are non-interactive

		const model = createModelForPersona(augmentedPersona);
		const result = await chatWithTools(model, messages, mergedTools, {
			assistantHeader: augmentedPersona.name,
		});

		const output = warningPrefix + result.text.trim();
		completeScheduleRun(runId, { status: "success", output });
		updateScheduleLastRun(schedule.id);
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		completeScheduleRun(runId, { status: "error", error: msg });
		updateScheduleLastRun(schedule.id);
	}
}
