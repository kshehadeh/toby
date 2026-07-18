import type { Persona } from "../config/index";
import { resolveDefaultPersona, resolvePersona } from "../personas/index";
import {
	defaultLlmPrompterOutputs,
	runLlmPrompterNode,
} from "./nodes/llm-prompter";
import {
	defaultToolExecutorOutputs,
	runToolExecutorNode,
} from "./nodes/tool-executor";
import { getAgent } from "./registry";
import { applyNodeOutputs, resolveNodeInputs } from "./resolve-inputs";
import type {
	AgentContextBag,
	AgentDefinition,
	AgentNodeTrace,
	AgentResult,
	AgentRunOptions,
} from "./types";
import { AgentNodeError } from "./types";

function resolveAgentPersona(
	definition: AgentDefinition,
	override?: Persona,
): Persona {
	if (override) return override;
	if (definition.personaName?.trim()) {
		const named = resolvePersona(definition.personaName.trim());
		if (named) return named;
	}
	if (definition.resolvePersona) {
		return definition.resolvePersona();
	}
	return resolveDefaultPersona();
}

/**
 * Run a registered agent by name with optional initial inputs and persona override.
 */
export async function runAgent(
	name: string,
	options: AgentRunOptions = {},
): Promise<AgentResult> {
	const definition = getAgent(name);
	if (!definition) {
		return {
			ok: false,
			agentName: name,
			outputs: {},
			nodeTrace: [],
			error: `Unknown agent "${name}"`,
		};
	}
	return runAgentDefinition(definition, options);
}

/**
 * Run an agent definition (does not require registry membership).
 */
export async function runAgentDefinition(
	definition: AgentDefinition,
	options: AgentRunOptions = {},
): Promise<AgentResult> {
	const persona = resolveAgentPersona(definition, options.personaOverride);
	const bag: AgentContextBag = { ...(options.inputs ?? {}) };
	const nodeTrace: AgentNodeTrace[] = [];

	for (const node of definition.nodes) {
		const started = Date.now();
		try {
			const inputs = resolveNodeInputs(node.id, node.inputs, bag);
			const runtime = {
				persona,
				bag,
				abortSignal: options.abortSignal,
			};

			if (node.type === "tool_executor") {
				const result = await runToolExecutorNode(node, inputs, runtime);
				const outputs = node.outputs ?? defaultToolExecutorOutputs();
				applyNodeOutputs(node.id, outputs, result, bag);
			} else {
				// llm_prompter (only other v1 node type)
				const result = await runLlmPrompterNode(node, inputs, runtime);
				const outputs = node.outputs ?? defaultLlmPrompterOutputs();
				applyNodeOutputs(node.id, outputs, result, bag);
			}

			nodeTrace.push({
				nodeId: node.id,
				type: node.type,
				durationMs: Date.now() - started,
				ok: true,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const failedNodeId =
				error instanceof AgentNodeError ? error.nodeId : node.id;
			nodeTrace.push({
				nodeId: node.id,
				type: node.type,
				durationMs: Date.now() - started,
				ok: false,
				error: message,
			});
			return {
				ok: false,
				agentName: definition.name,
				persona,
				outputs: bag,
				nodeTrace,
				error: message,
				failedNodeId,
			};
		}
	}

	return {
		ok: true,
		agentName: definition.name,
		persona,
		outputs: bag,
		nodeTrace,
	};
}
