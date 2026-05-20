import type { CoreMessage } from "../../ai/chat";
import { globalChatToolsPromptSection } from "../../ai/global-chat-tools";
import {
	type UserIntentSpec,
	formatUserMessageWithPretreatment,
} from "../../ai/pretreatment";
import type { Persona } from "../../config/index";
import { getDefaultProvider } from "../../config/index";
import {
	ALL_PROVIDER_CATEGORIES,
	PROVIDER_CATEGORY_LABELS,
	type ProviderCategory,
} from "../../integrations/types";
import type { IntegrationModule } from "../../integrations/types";
import { composeSystemPromptWithPersona } from "../../personas/prompt";
import { type LocalSkill, resolveSkillsByNames } from "../../skills/index";
import { getCurrentDateTimeInfo } from "../../ai/current-datetime";

/** Marker appended to system prompts when preflight attaches full SKILL.md bodies. */
export const SKILL_INSTRUCTIONS_APPENDIX_START =
	"\n\n---\n\n## Attached skill instructions (preflight)\n\n";
const CURRENT_DATETIME_START = "<!-- TOBY_DATETIME_START -->";
const CURRENT_DATETIME_END = "<!-- TOBY_DATETIME_END -->";

function buildCurrentDatetimeAppendix(): string {
	const now = getCurrentDateTimeInfo();
	return `\n\n${CURRENT_DATETIME_START}
## Current date and time

- Local datetime: ${now.localDateTime}
- Timezone: ${now.timeZone}
- UTC datetime: ${now.utcDateTime}
- Unix ms: ${now.unixMs}
${CURRENT_DATETIME_END}`;
}

function stripCurrentDatetimeAppendix(systemContent: string): string {
	const pattern = new RegExp(
		`\\n\\n${CURRENT_DATETIME_START}[\\s\\S]*?${CURRENT_DATETIME_END}`,
		"g",
	);
	return systemContent.replace(pattern, "");
}

export function injectCurrentDateTimeIntoFirstSystemMessage(
	messages: readonly CoreMessage[],
): CoreMessage[] {
	if (messages.length === 0) {
		return [...messages];
	}
	const first = messages[0];
	if (!first || first.role !== "system" || typeof first.content !== "string") {
		return [...messages];
	}
	const withoutCurrentTime = stripCurrentDatetimeAppendix(first.content);
	const nextSystem = `${withoutCurrentTime}${buildCurrentDatetimeAppendix()}`;
	if (nextSystem === first.content) {
		return [...messages];
	}
	const next = [...messages];
	next[0] = { ...first, content: nextSystem };
	return next;
}

export function stripSkillInstructionsAppendix(systemContent: string): string {
	const idx = systemContent.indexOf(SKILL_INSTRUCTIONS_APPENDIX_START);
	if (idx === -1) {
		return systemContent;
	}
	return systemContent.slice(0, idx);
}

/**
 * Appends resolved skill markdown bodies to the first system message.
 * Replaces any prior appendix from an earlier turn (same marker).
 */
export function injectSkillBodiesIntoFirstSystemMessage(
	messages: readonly CoreMessage[],
	selectedSkillNames: readonly string[],
	allSkills: readonly LocalSkill[],
): CoreMessage[] {
	if (messages.length === 0) {
		return [...messages];
	}
	const first = messages[0];
	if (!first || first.role !== "system" || typeof first.content !== "string") {
		return [...messages];
	}
	const base = stripSkillInstructionsAppendix(first.content);
	const resolved = resolveSkillsByNames(allSkills, selectedSkillNames);
	if (resolved.length === 0) {
		if (base === first.content) {
			return [...messages];
		}
		const next = [...messages];
		next[0] = { ...first, content: base };
		return next;
	}

	const blocks = resolved
		.map((s) => `### Skill: ${s.name}\n\n${s.bodyMarkdown}`)
		.join("\n\n---\n\n");
	const appendix = `${SKILL_INSTRUCTIONS_APPENDIX_START}${blocks}`;

	const next = [...messages];
	next[0] = { ...first, content: base + appendix };
	return next;
}

function buildDefaultProvidersSection(): string {
	const lines: string[] = [];
	for (const cat of ALL_PROVIDER_CATEGORIES) {
		const defaultName = getDefaultProvider(cat);
		if (defaultName) {
			lines.push(
				`- ${PROVIDER_CATEGORY_LABELS[cat]}: **${defaultName}** (use its tools by default for ${cat} tasks)`,
			);
		}
	}
	if (lines.length === 0) {
		return "";
	}
	return `Default providers (prefer these when the user's request matches):
${lines.join("\n")}`;
}

function buildCombinedChatBasePrompt(
	modules: readonly IntegrationModule[],
): string {
	const labels = modules.map((m) => m.displayName).join(", ");
	const integrationBlocks = modules
		.map((m) => m.chatModelPrep?.systemPromptSection?.trim())
		.filter((b): b is string => Boolean(b && b.length > 0))
		.join("\n\n");
	const defaultsSection = buildDefaultProvidersSection();

	return `You are Toby, a personal assistant with access to: **${labels}**.

Use the integration tools below for Gmail/Todoist/Slack/Azure AD work, plus the global Toby tools (**createLocalSkill**, **askUser**). Pick the right integration based on the user's request.

Shared rules:
- Use **askUser** whenever you need a multiple-choice decision from the user. The terminal does not respond to questions written only in plain assistant text.
- If the request is fully answered, stop without dangling "Would you like…?" in prose unless you call **askUser** with concrete options.
- When listing emails, tasks, or options in assistant text, prefer markdown list items (\`- item\`) with one item per line.
${defaultsSection ? `\n${defaultsSection}\n` : ""}
${integrationBlocks}
${globalChatToolsPromptSection()}
`;
}

function formatIntegrationPrepError(
	module: IntegrationModule,
	error: unknown,
): string {
	const message = error instanceof Error ? error.message : String(error);
	return `## ${module.displayName}\n\nConnection context unavailable (${message}). Slack/Gmail tools may still work once the connection recovers.`;
}

async function buildSingleModuleSessionMessages(
	module: IntegrationModule,
	persona: Persona,
	userPrompt: string,
): Promise<CoreMessage[]> {
	if (!module.chatModelPrep) {
		throw new Error(
			`prepareChatSessionMessages: integration "${module.name}" does not export chatModelPrep`,
		);
	}
	try {
		return await module.chatModelPrep.buildSingleSessionMessages(
			persona,
			userPrompt,
		);
	} catch (error) {
		const section = module.chatModelPrep.systemPromptSection?.trim();
		const systemContent = composeSystemPromptWithPersona(
			section
				? `### ${module.displayName}\n${section}`
				: `### ${module.displayName}`,
			persona,
		);
		return [
			{ role: "system", content: systemContent },
			{
				role: "user",
				content: `${formatIntegrationPrepError(module, error)}\n\nUser request:\n${userPrompt || "(no additional text — follow the system instruction.)"}`,
			},
		];
	}
}

export type SessionPrepProgress = (detail: string) => void | Promise<void>;

export async function prepareChatSessionMessages(
	modules: readonly IntegrationModule[],
	persona: Persona,
	userPrompt: string,
	onProgress?: SessionPrepProgress,
): Promise<CoreMessage[]> {
	if (modules.length === 0) {
		throw new Error("prepareChatSessionMessages: no modules");
	}

	const report = async (detail: string): Promise<void> => {
		await onProgress?.(detail);
	};

	if (modules.length === 1) {
		const only = modules[0];
		if (only) {
			await report(`Integration: ${only.displayName}`);
		}
	} else {
		await report(
			`Integrations: ${modules.map((m) => m.displayName).join(", ")}`,
		);
	}

	if (modules.length === 1) {
		const module = modules[0];
		if (!module) {
			throw new Error("prepareChatSessionMessages: missing module");
		}
		await report(`Loading ${module.displayName} connection context…`);
		const messages = await buildSingleModuleSessionMessages(
			module,
			persona,
			userPrompt,
		);
		await report(`${module.displayName} context ready.`);
		return injectCurrentDateTimeIntoFirstSystemMessage(messages);
	}
	await report("Loading integration context in parallel…");
	const parts = await Promise.all(
		modules.map(async (m) => {
			if (!m.chatModelPrep) {
				throw new Error(
					`prepareChatSessionMessages: integration "${m.name}" does not export chatModelPrep`,
				);
			}
			await report(`Loading ${m.displayName} connection context…`);
			try {
				const content = await m.chatModelPrep.buildMultiUserContent(userPrompt);
				await report(`${m.displayName} context ready.`);
				return content;
			} catch (error) {
				await report(`${m.displayName} context unavailable.`);
				return formatIntegrationPrepError(m, error);
			}
		}),
	);

	await report("Assembling combined session prompt…");
	const systemContent = composeSystemPromptWithPersona(
		buildCombinedChatBasePrompt(modules),
		persona,
	);

	return injectCurrentDateTimeIntoFirstSystemMessage([
		{ role: "system", content: systemContent },
		{
			role: "user",
			content: parts.filter(Boolean).join("\n\n---\n\n"),
		},
	]);
}

function coreMessageUserText(message: CoreMessage | undefined): string {
	if (!message || message.role !== "user") {
		return "";
	}
	const { content } = message;
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (typeof part === "string") {
					return part;
				}
				if (part && typeof part === "object" && "text" in part) {
					return String((part as { text: string }).text);
				}
				return "";
			})
			.join("");
	}
	return "";
}

/**
 * Replace only the first system message so a new persona applies to the rest of the session.
 */
export async function replaceSessionSystemMessageForPersona(
	modules: readonly IntegrationModule[],
	messages: readonly CoreMessage[],
	persona: Persona,
): Promise<CoreMessage[]> {
	if (messages.length === 0) {
		throw new Error("replaceSessionSystemMessageForPersona: empty messages");
	}
	if (modules.length === 0) {
		throw new Error("replaceSessionSystemMessageForPersona: no modules");
	}

	if (modules.length === 1) {
		const module = modules[0];
		if (!module) {
			throw new Error("replaceSessionSystemMessageForPersona: missing module");
		}
		if (!module.chatModelPrep) {
			throw new Error(
				`replaceSessionSystemMessageForPersona: integration "${module.name}" has no chatModelPrep`,
			);
		}
		const userPrompt = coreMessageUserText(messages[1]);
		const rebuilt = await module.chatModelPrep.buildSingleSessionMessages(
			persona,
			userPrompt,
		);
		const newSystem = rebuilt[0];
		if (!newSystem || newSystem.role !== "system") {
			throw new Error(
				"replaceSessionSystemMessageForPersona: expected system message at index 0",
			);
		}
		return injectCurrentDateTimeIntoFirstSystemMessage([
			newSystem,
			...messages.slice(1),
		]);
	}

	const systemContent = composeSystemPromptWithPersona(
		buildCombinedChatBasePrompt(modules),
		persona,
	);

	return injectCurrentDateTimeIntoFirstSystemMessage([
		{ role: "system", content: systemContent },
		...messages.slice(1),
	]);
}

/**
 * Merge a verbatim user prompt with an optional pretreatment spec for `prepareChatSessionMessages`.
 * Integration builders stay unaware of pretreatment; they only receive the final string.
 */
export function mergeUserPromptWithPretreatmentSpec(
	verbatim: string,
	spec: UserIntentSpec | null,
	skillsCatalog?: readonly LocalSkill[],
): string {
	return formatUserMessageWithPretreatment(verbatim, spec, skillsCatalog);
}
