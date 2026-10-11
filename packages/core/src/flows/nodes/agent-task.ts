import type { ModelMessage, Tool } from "ai";
import { chatWithTools, createModelForPersona } from "../../ai/chat";
import { createGlobalChatTools } from "../../ai/global-chat-tools";
import type { ChatEvent } from "../../chat-pipeline/chat-events";
import { resolveWebChatModules } from "../../chat-pipeline/resolve-chat-modules";
import { createMemoryTools } from "../../memory/tools";
import {
	injectMemoriesIntoFirstSystemMessage,
	injectProjectContextIntoFirstSystemMessage,
	injectSkillBodiesIntoFirstSystemMessage,
	prepareChatSessionMessages,
} from "../../prepare-messages";
import {
	loadProjectSkills,
	resolveProject,
	unionProjectOrganizationSkill,
} from "../../projects/index";
import { renderStoredSystemPrompt } from "../prompt-template";
import type { AgentTaskNodeDefinition, FlowNodeRuntime } from "../types";

export async function runAgentTaskNode(
	node: AgentTaskNodeDefinition,
	inputs: Readonly<Record<string, unknown>>,
	runtime: FlowNodeRuntime,
) {
	const prompt = node.userPrompt({
		persona: runtime.persona,
		inputs,
		bag: runtime.bag,
	});
	const persona = {
		...runtime.persona,
		instructions: `${runtime.persona.instructions}\n\n${node.systemPrompt ?? ""}\n\nThis is a Flow task. Complete it without asking questions or waiting for user input. Use your best judgment. Do not call askUser.`,
	};
	const project = node.projectId ? resolveProject(node.projectId) : null;
	if (node.projectId && !project)
		throw new Error(`Project "${node.projectId}" not found`);
	const { modules, warnings } = await resolveWebChatModules(prompt);
	let messages: ModelMessage[] = modules.length
		? await prepareChatSessionMessages(
				modules,
				persona,
				prompt,
				undefined,
				project,
			)
		: [
				{
					role: "system",
					content: renderStoredSystemPrompt(
						"Complete the requested Flow task using the available tools.",
						{
							composePersona: true,
							appendSkillsCatalog: true,
							appendCurrentDateTime: true,
						},
						{ persona, inputs, bag: runtime.bag },
					),
				},
				{ role: "user", content: prompt },
			];
	if (project) {
		messages = injectProjectContextIntoFirstSystemMessage(messages, project);
		const skills = loadProjectSkills(project);
		messages = injectSkillBodiesIntoFirstSystemMessage(
			messages,
			unionProjectOrganizationSkill([], skills),
			skills,
		);
	}
	messages = injectMemoriesIntoFirstSystemMessage(messages);
	const tools: Record<string, Tool> = {};
	for (const module of modules) {
		if (module.createChatTools)
			Object.assign(
				tools,
				(await module.createChatTools({ dryRun: false })).tools,
			);
	}
	const appliedActions: string[] = [];
	Object.assign(
		tools,
		createGlobalChatTools({ dryRun: false, persona, project, appliedActions }),
	);
	Object.assign(
		tools,
		createMemoryTools({ userId: "default", dryRun: false, appliedActions }),
	);
	// All Flow tasks are noninteractive, including manual invocations.
	Reflect.deleteProperty(tools, "askUser");
	const transcript: ChatEvent[] = [];
	const result = await chatWithTools(
		createModelForPersona(persona),
		messages,
		tools,
		{
			assistantHeader: persona.name,
			abortSignal: runtime.abortSignal,
			onChatEvent: (event) => {
				transcript.push(event);
			},
		},
	);
	return {
		object: { markdown: result.text.trim() },
		detail: {
			kind: "agent_task" as const,
			prompt,
			projectId: node.projectId ?? null,
			transcript,
			warnings,
			appliedActions,
		},
	};
}
