import type { CoreMessage } from "../../ai/chat";
import { globalChatToolsPromptSection } from "../../ai/global-chat-tools";
import {
	type UserIntentSpec,
	formatUserMessageWithPretreatment,
} from "../../ai/pretreatment";
import type { Persona } from "../../config/index";
import type { IntegrationModule } from "../../integrations/types";
import { composeSystemPromptWithPersona } from "../../personas/prompt";
import { type LocalSkill, resolveSkillsByNames } from "../../skills/index";

/** Marker appended to system prompts when preflight attaches full SKILL.md bodies. */
export const SKILL_INSTRUCTIONS_APPENDIX_START =
	"\n\n---\n\n## Attached skill instructions (preflight)\n\n";

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
	const resolved = resolveSkillsByNames(allSkills, selectedSkillNames);
	if (resolved.length === 0) {
		return [...messages];
	}

	const blocks = resolved
		.map((s) => `### Skill: ${s.name}\n\n${s.bodyMarkdown}`)
		.join("\n\n---\n\n");
	const appendix = `${SKILL_INSTRUCTIONS_APPENDIX_START}${blocks}`;

	return messages.map((m, i) => {
		if (i !== 0 || m.role !== "system") {
			return m;
		}
		const { content } = m;
		if (typeof content !== "string") {
			return m;
		}
		const base = stripSkillInstructionsAppendix(content);
		return { ...m, content: base + appendix };
	});
}

function buildCombinedChatBasePrompt(
	modules: readonly IntegrationModule[],
): string {
	const labels = modules.map((m) => m.displayName).join(", ");
	const integrationBlocks = modules
		.map((m) => m.chatModelPrep?.systemPromptSection?.trim())
		.filter((b): b is string => Boolean(b && b.length > 0))
		.join("\n\n");

	return `You are Toby, a personal assistant with access to: **${labels}**.

Use the integration tools below for Gmail/Todoist/Azure AD work, plus the global Toby tools (**createLocalSkill**, **askUser**). Pick the right integration based on the user's request.

Shared rules:
- Use **askUser** whenever you need a multiple-choice decision from the user. The terminal does not respond to questions written only in plain assistant text.
- If the request is fully answered, stop without dangling "Would you like…?" in prose unless you call **askUser** with concrete options.
- When listing emails, tasks, or options in assistant text, prefer markdown list items (\`- item\`) with one item per line.

${integrationBlocks}
${globalChatToolsPromptSection()}
`;
}

export async function prepareChatSessionMessages(
	modules: readonly IntegrationModule[],
	persona: Persona,
	userPrompt: string,
): Promise<CoreMessage[]> {
	if (modules.length === 0) {
		throw new Error("prepareChatSessionMessages: no modules");
	}

	if (modules.length === 1) {
		const module = modules[0];
		if (!module) {
			throw new Error("prepareChatSessionMessages: missing module");
		}
		if (!module.chatModelPrep) {
			throw new Error(
				`prepareChatSessionMessages: integration "${module.name}" does not export chatModelPrep`,
			);
		}
		return await module.chatModelPrep.buildSingleSessionMessages(
			persona,
			userPrompt,
		);
	}
	const parts = await Promise.all(
		modules.map(async (m) => {
			if (!m.chatModelPrep) {
				throw new Error(
					`prepareChatSessionMessages: integration "${m.name}" does not export chatModelPrep`,
				);
			}
			return await m.chatModelPrep.buildMultiUserContent(userPrompt);
		}),
	);

	const systemContent = composeSystemPromptWithPersona(
		buildCombinedChatBasePrompt(modules),
		persona,
	);

	return [
		{ role: "system", content: systemContent },
		{
			role: "user",
			content: parts.filter(Boolean).join("\n\n---\n\n"),
		},
	];
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
		return [newSystem, ...messages.slice(1)];
	}

	const systemContent = composeSystemPromptWithPersona(
		buildCombinedChatBasePrompt(modules),
		persona,
	);

	return [{ role: "system", content: systemContent }, ...messages.slice(1)];
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
