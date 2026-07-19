import { resolveDashboardPersona } from "../dashboard/prompts";
import type {
	FlowDocument,
	StoredFlowNode,
	StoredLlmPrompterNode,
	StoredToolExecutorNode,
} from "./document-types";
import {
	renderStoredSystemPrompt,
	renderStoredUserPrompt,
} from "./prompt-template";
import { schemaFromSpec } from "./schema-presets";
import type {
	FlowDefinition,
	FlowNodeDefinition,
	LlmPrompterNodeDefinition,
	ToolExecutorNodeDefinition,
} from "./types";

function hydrateToolExecutorNode(
	node: StoredToolExecutorNode,
): ToolExecutorNodeDefinition {
	return {
		id: node.id,
		type: "tool_executor",
		tool: node.tool,
		...(node.inputs ? { inputs: node.inputs } : {}),
		...(node.outputs ? { outputs: node.outputs } : {}),
	};
}

function hydrateLlmPrompterNode(
	node: StoredLlmPrompterNode,
): LlmPrompterNodeDefinition {
	const schema = schemaFromSpec(node.schema);
	const helpers = node.promptHelpers;
	const systemTemplate = node.systemPrompt;
	const userTemplate = node.userPrompt;

	return {
		id: node.id,
		type: "llm_prompter",
		schema,
		...(node.schemaName ? { schemaName: node.schemaName } : {}),
		...(node.schemaDescription
			? { schemaDescription: node.schemaDescription }
			: {}),
		...(node.inputs ? { inputs: node.inputs } : {}),
		...(node.outputs ? { outputs: node.outputs } : {}),
		...(node.temperature !== undefined
			? { temperature: node.temperature }
			: {}),
		...(node.maxOutputTokens !== undefined
			? { maxOutputTokens: node.maxOutputTokens }
			: {}),
		...(node.timeoutMs !== undefined ? { timeoutMs: node.timeoutMs } : {}),
		systemPrompt: (ctx) =>
			renderStoredSystemPrompt(systemTemplate, helpers, ctx),
		userPrompt: (ctx) => renderStoredUserPrompt(userTemplate, ctx),
	};
}

function hydrateNode(node: StoredFlowNode): FlowNodeDefinition {
	if (node.type === "tool_executor") {
		return hydrateToolExecutorNode(node);
	}
	return hydrateLlmPrompterNode(node);
}

/**
 * Convert a stored FlowDocument into a runtime FlowDefinition
 * (Zod schemas + prompt functions).
 */
export function hydrateFlowDocument(document: FlowDocument): FlowDefinition {
	const id = document.id.trim();
	if (!id) {
		throw new Error("Flow document must have a non-empty id");
	}
	if (document.nodes.length === 0) {
		throw new Error(`Flow "${id}" must have at least one node`);
	}

	const def: FlowDefinition = {
		// Runtime key is the stable document id (matches flow_runs.flow_name).
		name: id,
		...(document.description ? { description: document.description } : {}),
		nodes: document.nodes.map(hydrateNode),
	};

	const persona = document.persona;
	if (persona?.source === "named" && persona.name.trim()) {
		return {
			...def,
			personaName: persona.name.trim(),
		};
	}
	if (persona?.source === "dashboard") {
		return {
			...def,
			resolvePersona: resolveDashboardPersona,
		};
	}
	return def;
}
