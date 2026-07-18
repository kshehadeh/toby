import type { Persona } from "../config/index";
import { resolveDefaultPersona, resolvePersona } from "../personas/index";
import { buildDefinitionSnapshot } from "./definition-snapshot";
import {
	defaultLlmPrompterOutputs,
	runLlmPrompterNode,
} from "./nodes/llm-prompter";
import {
	defaultToolExecutorOutputs,
	runToolExecutorNode,
} from "./nodes/tool-executor";
import { getFlow } from "./registry";
import {
	applyNodeOutputs,
	getByPath,
	resolveNodeInputs,
} from "./resolve-inputs";
import {
	completeFlowRun,
	completeFlowRunNode,
	createFlowRun,
	insertFlowRunNode,
} from "./store";
import type {
	FlowContextBag,
	FlowDefinition,
	FlowNodeDetail,
	FlowNodeRecord,
	FlowOutputMap,
	FlowResult,
	FlowRunOptions,
} from "./types";
import { FlowNodeError } from "./types";

function nowIso(): string {
	return new Date().toISOString();
}

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

function collectBagWrites(
	outputs: FlowOutputMap,
	nodeResult: unknown,
): Record<string, unknown> {
	const writes: Record<string, unknown> = {};
	for (const [contextKey, path] of Object.entries(outputs)) {
		writes[contextKey] = getByPath(nodeResult, path);
	}
	return writes;
}

/**
 * Run a registered flow by name with optional initial inputs and persona override.
 */
export async function runFlow(
	name: string,
	options: FlowRunOptions = {},
): Promise<FlowResult> {
	const definition = getFlow(name);
	const startedAt = nowIso();
	const wallStart = Date.now();
	if (!definition) {
		return {
			ok: false,
			flowName: name,
			outputs: {},
			nodeTrace: [],
			error: `Unknown flow "${name}"`,
			startedAt,
			completedAt: nowIso(),
			durationMs: Date.now() - wallStart,
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
	const wallStart = Date.now();
	const startedAt = nowIso();
	const record = options.record !== false;
	const persona = resolveFlowPersona(definition, options.personaOverride);
	const provider = persona.ai.provider;
	const model = persona.ai.model;
	const bag: FlowContextBag = { ...(options.inputs ?? {}) };
	const nodeTrace: FlowNodeRecord[] = [];

	const runId = record
		? createFlowRun({
				flowName: definition.name,
				personaName: persona.name,
				provider,
				model,
				trigger: options.trigger ?? null,
				definitionSnapshot: buildDefinitionSnapshot(definition),
				initialInputs: options.inputs ?? {},
				startedAt,
			})
		: null;

	let order = 0;
	for (const node of definition.nodes) {
		const nodeStartedMs = Date.now();
		const nodeStartedAt = nowIso();
		const nodeRowId =
			record && runId
				? insertFlowRunNode({
						runId,
						nodeId: node.id,
						nodeType: node.type,
						nodeOrder: order,
						startedAt: nodeStartedAt,
					})
				: null;

		try {
			const inputs = resolveNodeInputs(node.id, node.inputs, bag);
			const runtime = {
				persona,
				bag,
				abortSignal: options.abortSignal,
			};

			let nodeResult: unknown;
			let detail: FlowNodeDetail | undefined;
			let outputsMap: FlowOutputMap;

			if (node.type === "tool_executor") {
				const result = await runToolExecutorNode(node, inputs, runtime);
				nodeResult = result;
				detail = result.detail;
				outputsMap = node.outputs ?? defaultToolExecutorOutputs();
			} else {
				const result = await runLlmPrompterNode(node, inputs, runtime);
				nodeResult = result;
				detail = result.detail;
				outputsMap = node.outputs ?? defaultLlmPrompterOutputs();
			}

			applyNodeOutputs(node.id, outputsMap, nodeResult, bag);
			const bagWrites = collectBagWrites(outputsMap, nodeResult);
			const durationMs = Date.now() - nodeStartedMs;
			const completedAt = nowIso();

			const recordEntry: FlowNodeRecord = {
				nodeId: node.id,
				type: node.type,
				order,
				status: "success",
				durationMs,
				startedAt: nodeStartedAt,
				completedAt,
				inputs,
				bagWrites,
				nodeResult,
				detail,
			};
			nodeTrace.push(recordEntry);

			if (nodeRowId) {
				completeFlowRunNode({
					id: nodeRowId,
					status: "success",
					inputs,
					outputs: {
						bagWrites,
						nodeResult,
					},
					detail,
					durationMs,
					completedAt,
				});
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const failedNodeId =
				error instanceof FlowNodeError ? error.nodeId : node.id;
			const durationMs = Date.now() - nodeStartedMs;
			const completedAt = nowIso();
			const detail =
				error &&
				typeof error === "object" &&
				"detail" in error &&
				(error as { detail?: FlowNodeDetail }).detail
					? (error as { detail: FlowNodeDetail }).detail
					: undefined;

			let inputs: Record<string, unknown> = {};
			try {
				inputs = resolveNodeInputs(node.id, node.inputs, bag);
			} catch {
				// leave empty if inputs themselves failed
			}

			const recordEntry: FlowNodeRecord = {
				nodeId: node.id,
				type: node.type,
				order,
				status: "error",
				durationMs,
				startedAt: nodeStartedAt,
				completedAt,
				inputs,
				bagWrites: {},
				error: message,
				...(detail ? { detail } : {}),
			};
			nodeTrace.push(recordEntry);

			if (nodeRowId) {
				completeFlowRunNode({
					id: nodeRowId,
					status: "error",
					inputs,
					outputs: null,
					detail,
					error: message,
					durationMs,
					completedAt,
				});
			}

			const completedAtRun = nowIso();
			const durationMsRun = Date.now() - wallStart;
			if (runId) {
				completeFlowRun({
					id: runId,
					status: "error",
					finalOutputs: bag,
					error: message,
					failedNodeId,
					durationMs: durationMsRun,
					completedAt: completedAtRun,
				});
			}

			return {
				ok: false,
				flowName: definition.name,
				persona,
				provider,
				model,
				outputs: bag,
				nodeTrace,
				error: message,
				failedNodeId,
				...(runId ? { runId } : {}),
				startedAt,
				completedAt: completedAtRun,
				durationMs: durationMsRun,
			};
		}

		order += 1;
	}

	const completedAt = nowIso();
	const durationMs = Date.now() - wallStart;
	if (runId) {
		completeFlowRun({
			id: runId,
			status: "success",
			finalOutputs: bag,
			durationMs,
			completedAt,
		});
	}

	return {
		ok: true,
		flowName: definition.name,
		persona,
		provider,
		model,
		outputs: bag,
		nodeTrace,
		...(runId ? { runId } : {}),
		startedAt,
		completedAt,
		durationMs,
	};
}
