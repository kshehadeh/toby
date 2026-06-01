import { chatWithTools, createModelForPersona } from "@toby/core/ai/chat";
import {
	inferProviderCategoriesFromPrompt,
	resolveChatModulesForPrompt,
} from "@toby/core/chat-pipeline/resolve-chat-modules";
import { getDefaultProvider } from "@toby/core/config/index";
import type { Persona } from "@toby/core/config/index";
import {
	getModulesForCategory,
	getModulesWithCapability,
} from "@toby/core/integrations/index";
import {
	PROVIDER_CATEGORY_LABELS,
	type ProviderCategory,
} from "@toby/core/integrations/types";
import { resolvePersona } from "@toby/core/personas/index";
import { prepareChatSessionMessages } from "@toby/core/prepare-messages";
import { recordScheduleInvariantFailureAndThrow } from "./invariant-record";
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

export async function executeSchedule(schedule: Schedule): Promise<void> {
	const persona = resolvePersona(schedule.personaName);
	if (!persona) {
		recordScheduleInvariantFailureAndThrow(
			schedule,
			`Schedule "${schedule.name}": persona "${schedule.personaName}" not found`,
		);
	}

	const allChatModules = getModulesWithCapability("chat").filter((m) => m.chat);
	if (allChatModules.length === 0) {
		recordScheduleInvariantFailureAndThrow(
			schedule,
			`Schedule "${schedule.name}": no chat-capable integrations available`,
		);
	}

	const { modules: chatModules, warnings } = resolveChatModulesForPrompt(
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
		const { createGlobalChatTools } = await import(
			"@toby/core/ai/global-chat-tools"
		);
		const globalApplied: string[] = [];
		Object.assign(
			mergedTools,
			createGlobalChatTools({
				dryRun: false,
				persona: augmentedPersona,
				appliedActions: globalApplied,
			}),
		);

		const { createMemoryTools } = await import("@toby/core/memory/tools");
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
