import { chatWithTools, createModelForPersona } from "../ai/chat";
import type { ChatEventSink } from "../chat-pipeline/chat-events";
import {
	inferProviderCategoriesFromPrompt,
	resolveChatModulesForPrompt,
} from "../chat-pipeline/resolve-chat-modules";
import { getDefaultProvider } from "../config/index";
import type { Persona } from "../config/index";
import {
	getModulesForCategory,
	getModulesWithCapability,
} from "../integrations/index";
import {
	PROVIDER_CATEGORY_LABELS,
	type ProviderCategory,
} from "../integrations/types";
import { notifyNativeScheduleCompleted } from "../native-app/notifications";
import { resolvePersona } from "../personas/index";
import {
	injectMemoriesIntoFirstSystemMessage,
	injectProjectContextIntoFirstSystemMessage,
	prepareChatSessionMessages,
} from "../prepare-messages";
import { resolveProject } from "../projects/index";
import {
	completeScheduleRun,
	createScheduleRun,
	updateScheduleLastRun,
	updateScheduleRunTranscript,
} from "./store";
import type { Schedule } from "./types";

const SCHEDULE_SYSTEM_INSTRUCTION_APPENDIX = `

---

## Scheduled run policy

This is an automated scheduled run. You **must not** ask questions or wait for user input. There is no interactive user available. Complete the task using your best judgment. If something is ambiguous, make a reasonable assumption and proceed. Do not call the askUser tool — it is not available in this context.
`;

export function createScheduleRunForExecution(schedule: Schedule): string {
	return createScheduleRun({
		scheduleId: schedule.id,
		personaName: schedule.personaName,
		prompt: schedule.prompt,
	});
}

export async function executeScheduleRun(
	runId: string,
	schedule: Schedule,
	options?: { onChatEvent?: ChatEventSink },
): Promise<void> {
	const persona = resolvePersona(schedule.personaName);
	if (!persona) {
		await completeScheduleRunWithError(
			runId,
			schedule,
			`Schedule "${schedule.name}": persona "${schedule.personaName}" not found`,
		);
		return;
	}

	const allChatModules = getModulesWithCapability("chat").filter((m) => m.chat);
	if (allChatModules.length === 0) {
		await completeScheduleRunWithError(
			runId,
			schedule,
			`Schedule "${schedule.name}": no chat-capable integrations available`,
		);
		return;
	}

	const { modules: chatModules, warnings } = resolveChatModulesForPrompt(
		schedule.prompt,
		allChatModules,
	);

	const transcriptEvents: unknown[] = [];
	const onChatEvent: ChatEventSink = (event) => {
		options?.onChatEvent?.(event);
		transcriptEvents.push(event);
		try {
			updateScheduleRunTranscript(runId, safeStringify(transcriptEvents));
		} catch {
			// Persist best-effort; non-serializable tool results are ignored.
		}
	};

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
		await completeScheduleRunWithError(
			runId,
			schedule,
			`Cannot execute schedule "${schedule.name}": ${details}`,
		);
		return;
	}

	try {
		const project = schedule.projectId
			? resolveProject(schedule.projectId)
			: null;
		const warningPrefix =
			warnings.length > 0
				? `[Schedule warnings: ${warnings.join(" | ")}]\n\n`
				: "";

		const augmentedPersona: Persona = {
			...persona,
			instructions: persona.instructions + SCHEDULE_SYSTEM_INSTRUCTION_APPENDIX,
		};

		let messages = await prepareChatSessionMessages(
			chatModules,
			augmentedPersona,
			schedule.prompt,
			undefined,
			project,
		);
		if (project) {
			messages = injectProjectContextIntoFirstSystemMessage(messages, project);
		}
		messages = injectMemoriesIntoFirstSystemMessage(messages);

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
				project,
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
			onChatEvent,
		});

		const output = warningPrefix + result.text.trim();
		completeScheduleRun(runId, { status: "success", output });
		updateScheduleLastRun(schedule.id);
		await notifyNativeScheduleCompleted({
			scheduleId: schedule.id,
			scheduleName: schedule.name,
			runId,
			status: "success",
		});
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		completeScheduleRun(runId, { status: "error", error: msg });
		updateScheduleLastRun(schedule.id);
		await notifyNativeScheduleCompleted({
			scheduleId: schedule.id,
			scheduleName: schedule.name,
			runId,
			status: "error",
			error: msg,
		});
	}
}

export async function executeSchedule(
	schedule: Schedule,
	options?: { onChatEvent?: ChatEventSink },
): Promise<void> {
	const runId = createScheduleRunForExecution(schedule);
	await executeScheduleRun(runId, schedule, options);
}

async function completeScheduleRunWithError(
	runId: string,
	schedule: Schedule,
	error: string,
): Promise<void> {
	completeScheduleRun(runId, { status: "error", error });
	updateScheduleLastRun(schedule.id);
	await notifyNativeScheduleCompleted({
		scheduleId: schedule.id,
		scheduleName: schedule.name,
		runId,
		status: "error",
		error,
	});
}

function safeStringify(value: unknown): string {
	const seen = new Set<unknown>();
	return JSON.stringify(value, (_key, val) => {
		if (typeof val === "object" && val !== null) {
			if (seen.has(val)) return "[Circular]";
			seen.add(val);
		}
		if (typeof val === "bigint") return val.toString();
		if (typeof val === "function") return "[Function]";
		return val;
	});
}
