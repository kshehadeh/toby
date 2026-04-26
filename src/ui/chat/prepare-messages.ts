import type { CoreMessage } from "../../ai/chat";
import type { Persona } from "../../config/index";
import {
	buildGmailChatSystemMessage,
	buildGmailChatUserMessage,
} from "../../integrations/gmail/prompts/chat";
import {
	fetchCompletedTasks,
	fetchOpenTasks,
} from "../../integrations/todoist/client";
import {
	buildTodoistChatSystemMessage,
	buildTodoistChatUserMessage,
} from "../../integrations/todoist/prompts/chat";
import type { IntegrationModule } from "../../integrations/types";
import { composeSystemPromptWithPersona } from "../../personas/prompt";

function buildCombinedChatBasePrompt(
	modules: readonly IntegrationModule[],
	userInstruction: string,
): string {
	const labels = modules.map((m) => m.displayName).join(", ");
	const gmail = modules.some((m) => m.name === "gmail");
	const todoist = modules.some((m) => m.name === "todoist");

	const gmailBlock = gmail
		? `### Gmail
You are assisting with Gmail. Use Gmail tools to inspect or change the mailbox. Prefer holistic inbox overview before loading many messages. Never claim a mutation succeeded unless the corresponding Gmail tool succeeded.
`
		: "";

	const todoistBlock = todoist
		? `### Todoist
You are assisting with Todoist. Use Todoist tools to create, read, or update tasks. Open/completed task snapshots may appear in the user message below. Never claim a task changed unless the corresponding Todoist tool succeeded.
`
		: "";

	return `You are Toby, a personal assistant with access to: **${labels}**.

Use only the tools that belong to the integrations above. Pick the right integration based on the user's request.

Shared rules:
- Use **askUser** whenever you need a multiple-choice decision from the user. The terminal does not respond to questions written only in plain assistant text.
- If the request is fully answered, stop without dangling "Would you like…?" in prose unless you call **askUser** with concrete options.

${gmailBlock}
${todoistBlock}
User instruction:
${userInstruction}
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
		if (module.name === "gmail") {
			return [
				buildGmailChatSystemMessage(persona, userPrompt),
				buildGmailChatUserMessage(userPrompt),
			];
		}

		if (module.name === "todoist") {
			const openTasks = await fetchOpenTasks();
			const completedTasks = await fetchCompletedTasks();
			return [
				buildTodoistChatSystemMessage(persona, userPrompt),
				buildTodoistChatUserMessage(openTasks, completedTasks),
			];
		}

		throw new Error(
			`prepareChatSessionMessages: no chat session builder for "${module.name}"`,
		);
	}

	const hasGmail = modules.some((m) => m.name === "gmail");
	const hasTodoist = modules.some((m) => m.name === "todoist");

	const parts: string[] = [];

	if (hasGmail) {
		parts.push(`## Gmail
Carry out the Gmail parts of the request using Gmail tools as needed. Prefer inbox overview before loading many full messages.

If you need a decision from the user, call **askUser** with options.

User request (may also mention other integrations):
${userPrompt || "(no additional text — follow the system instruction.)"}`);
	}

	if (hasTodoist) {
		const openTasks = await fetchOpenTasks();
		const completedTasks = await fetchCompletedTasks();
		const todoistUser = buildTodoistChatUserMessage(openTasks, completedTasks);
		const todoistContent =
			typeof todoistUser.content === "string"
				? todoistUser.content
				: JSON.stringify(todoistUser.content);
		parts.push(`## Todoist context and instructions
Apply the system instruction using Todoist tools when tasks are involved.

${todoistContent}`);
	}

	const systemContent = composeSystemPromptWithPersona(
		buildCombinedChatBasePrompt(modules, userPrompt),
		persona,
	);

	return [
		{ role: "system", content: systemContent },
		{
			role: "user",
			content: parts.join("\n\n---\n\n"),
		},
	];
}
