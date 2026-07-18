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
import { getFlow } from "./registry";
import { applyNodeOutputs, resolveNodeInputs } from "./resolve-inputs";
import type {
	FlowContextBag,
	FlowDefinition,
	FlowNodeTrace,
	FlowResult,
	FlowRunOptions,
} from "./types";
import { FlowNodeError } from "./types";

function resolveFlowPersona(
	definition: FlowDefinition,
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
 * Run a registered flow by name with optional initial inputs and persona override.
 */
export async function runFlow(
	name: string,
	options: FlowRunOptions = {},
): Promise<FlowResult> {
	const definition = getFlow(name);
	if (!definition) {
		return {
			ok: false,
			flowName: name,
			outputs: {},
			nodeTrace: [],
			error: `Unknown flow "${name}"`,
		};
	}
	return runFlowDefinition(definition, options);
}

/**
 * Run a flow definition (does not require registry membership).
 */
export async function runFlowDefinition(
	definition: FlowDefinition,
	options: FlowRunOptions = {},
): Promise<FlowResult> {
	const persona = resolveFlowPersona(definition, options.personaOverride);
	const bag: FlowContextBag = { ...(options.inputs ?? {}) };
	const nodeTrace: FlowNodeTrace[] = [];

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
				error instanceof FlowNodeError ? error.nodeId : node.id;
			nodeTrace.push({
				nodeId: node.id,
				type: node.type,
				durationMs: Date.now() - started,
				ok: false,
				error: message,
			});
			return {
				ok: false,
				flowName: definition.name,
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
		flowName: definition.name,
		persona,
		outputs: bag,
		nodeTrace,
	};
}
