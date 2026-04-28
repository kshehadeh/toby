import type { CoreMessage } from "../../ai/chat";
import {
	type UserIntentSpec,
	formatUserMessageWithPretreatment,
} from "../../ai/pretreatment";
import type { Persona } from "../../config/index";
import type { IntegrationModule } from "../../integrations/types";
import { composeSystemPromptWithPersona } from "../../personas/prompt";

function buildCombinedChatBasePrompt(
	modules: readonly IntegrationModule[],
): string {
	const labels = modules.map((m) => m.displayName).join(", ");
	const integrationBlocks = modules
		.map((m) => m.chatModelPrep?.systemPromptSection?.trim())
		.filter((b): b is string => Boolean(b && b.length > 0))
		.join("\n\n");

	return `You are Toby, a personal assistant with access to: **${labels}**.

Use only the tools that belong to the integrations above. Pick the right integration based on the user's request.

Shared rules:
- Use **askUser** whenever you need a multiple-choice decision from the user. The terminal does not respond to questions written only in plain assistant text.
- If the request is fully answered, stop without dangling "Would you like…?" in prose unless you call **askUser** with concrete options.
- When listing emails, tasks, or options in assistant text, prefer markdown list items (\`- item\`) with one item per line.

${integrationBlocks}
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

/**
 * Merge a verbatim user prompt with an optional pretreatment spec for `prepareChatSessionMessages`.
 * Integration builders stay unaware of pretreatment; they only receive the final string.
 */
export function mergeUserPromptWithPretreatmentSpec(
	verbatim: string,
	spec: UserIntentSpec | null,
): string {
	return formatUserMessageWithPretreatment(verbatim, spec);
}
