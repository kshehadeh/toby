import { generateText } from "ai";
import type { CoreMessage } from "../ai/chat";
import { chatWithTools, createModelForPersona } from "../ai/chat";
import type { Persona } from "../config/index";
import { getModulesWithCapability } from "../integrations/index";
import type { IntegrationModule } from "../integrations/types";
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

export async function executeSchedule(schedule: Schedule): Promise<void> {
	const persona = resolvePersona(schedule.personaName);
	if (!persona) {
		throw new Error(
			`Schedule "${schedule.name}": persona "${schedule.personaName}" not found`,
		);
	}

	const chatModules = getModulesWithCapability("chat").filter((m) => m.chat);
	if (chatModules.length === 0) {
		throw new Error(
			`Schedule "${schedule.name}": no chat-capable integrations available`,
		);
	}

	const runId = createScheduleRun({
		scheduleId: schedule.id,
		personaName: schedule.personaName,
		prompt: schedule.prompt,
	});

	try {
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

		const output = result.text.trim();
		completeScheduleRun(runId, { status: "success", output });
		updateScheduleLastRun(schedule.id);
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		completeScheduleRun(runId, { status: "error", error: msg });
		updateScheduleLastRun(schedule.id);
	}
}
