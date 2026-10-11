import type {
	FlowDestination,
	FlowDocument,
	FlowPersonaSpec,
	FlowResultPointer,
	FlowSchemaSpec,
	StoredFlowNode,
	StoredLlmPrompterNode,
	StoredToolExecutorNode,
} from "./document-types";
import { schemaFromSpec } from "./schema-presets";
import { parseFlowTriggers } from "./triggers/types";
import type { FlowInputMap, FlowOutputMap, ToolRef } from "./types";
import { UserFlowValidationError } from "./validate-user-flow";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseToolRef(raw: unknown): ToolRef | null {
	if (!isRecord(raw)) return null;
	if (typeof raw.userToolId === "string" && raw.userToolId.trim()) {
		return { userToolId: raw.userToolId.trim() };
	}
	if (typeof raw.standardTool === "string" && raw.standardTool.trim()) {
		return { standardTool: raw.standardTool };
	}
	if (
		typeof raw.moduleName === "string" &&
		typeof raw.toolName === "string" &&
		raw.moduleName.trim() &&
		raw.toolName.trim()
	) {
		return { moduleName: raw.moduleName, toolName: raw.toolName };
	}
	return null;
}

function parseInputs(raw: unknown): FlowInputMap | undefined {
	if (!isRecord(raw)) return undefined;
	const out: Record<
		string,
		{ const: unknown } | { from: string; path?: string }
	> = {};
	for (const [key, source] of Object.entries(raw)) {
		if (!isRecord(source)) continue;
		if ("const" in source) {
			out[key] = { const: source.const };
			continue;
		}
		if (typeof source.from === "string") {
			out[key] = {
				from: source.from,
				...(typeof source.path === "string" ? { path: source.path } : {}),
			};
		}
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function parseOutputs(raw: unknown): FlowOutputMap | undefined {
	if (!isRecord(raw)) return undefined;
	const out: Record<string, string> = {};
	for (const [key, path] of Object.entries(raw)) {
		if (typeof path === "string") out[key] = path;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function parseCondition(raw: unknown): { from: string; path?: string } {
	if (
		!isRecord(raw) ||
		typeof raw.from !== "string" ||
		!raw.from.trim() ||
		"const" in raw ||
		(raw.path !== undefined && typeof raw.path !== "string")
	) {
		throw new UserFlowValidationError([
			"Action condition needs an output reference with an optional field path",
		]);
	}
	return {
		from: raw.from,
		...(raw.path !== undefined ? { path: raw.path as string } : {}),
	};
}

function parseSchema(raw: unknown): FlowSchemaSpec {
	const spec = (raw ?? { kind: "markdown" }) as FlowSchemaSpec;
	try {
		schemaFromSpec(spec);
	} catch (error) {
		throw new UserFlowValidationError([
			error instanceof Error ? error.message : "Invalid output schema",
		]);
	}
	return spec;
}

function parseNode(raw: unknown): StoredFlowNode | null {
	if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id.trim()) {
		return null;
	}
	if (raw.type === "tool_executor") {
		const tool = parseToolRef(raw.tool);
		if (!tool) return null;
		const node: StoredToolExecutorNode = {
			id: raw.id,
			type: "tool_executor",
			tool,
			...(raw.when !== undefined ? { when: parseCondition(raw.when) } : {}),
			...(parseInputs(raw.inputs) ? { inputs: parseInputs(raw.inputs) } : {}),
			...(parseOutputs(raw.outputs)
				? { outputs: parseOutputs(raw.outputs) }
				: {}),
		};
		return node;
	}
	if (raw.type === "agent_task") {
		if (raw.when !== undefined)
			throw new UserFlowValidationError([
				"Conditions are supported only on tool actions",
			]);
		if (typeof raw.userPrompt !== "string" || !raw.userPrompt.trim())
			return null;
		return {
			id: raw.id,
			type: "agent_task",
			systemPrompt:
				typeof raw.systemPrompt === "string" ? raw.systemPrompt : "",
			userPrompt: raw.userPrompt,
			...(parseInputs(raw.inputs) ? { inputs: parseInputs(raw.inputs) } : {}),
			...(parseOutputs(raw.outputs)
				? { outputs: parseOutputs(raw.outputs) }
				: {}),
		};
	}
	if (raw.type === "llm_prompter") {
		if (raw.when !== undefined)
			throw new UserFlowValidationError([
				"Conditions are supported only on tool actions",
			]);
		const node: StoredLlmPrompterNode = {
			id: raw.id,
			type: "llm_prompter",
			schema: parseSchema(raw.schema),
			systemPrompt:
				typeof raw.systemPrompt === "string" ? raw.systemPrompt : "",
			userPrompt: typeof raw.userPrompt === "string" ? raw.userPrompt : "",
			...(typeof raw.schemaName === "string"
				? { schemaName: raw.schemaName }
				: {}),
			...(typeof raw.schemaDescription === "string"
				? { schemaDescription: raw.schemaDescription }
				: {}),
			...(isRecord(raw.promptHelpers)
				? {
						promptHelpers: {
							...(typeof raw.promptHelpers.composePersona === "boolean"
								? { composePersona: raw.promptHelpers.composePersona }
								: {}),
							...(typeof raw.promptHelpers.appendSkillsCatalog === "boolean"
								? {
										appendSkillsCatalog: raw.promptHelpers.appendSkillsCatalog,
									}
								: {}),
							...(typeof raw.promptHelpers.appendCurrentDateTime === "boolean"
								? {
										appendCurrentDateTime:
											raw.promptHelpers.appendCurrentDateTime,
									}
								: {}),
						},
					}
				: {}),
			...(parseInputs(raw.inputs) ? { inputs: parseInputs(raw.inputs) } : {}),
			...(parseOutputs(raw.outputs)
				? { outputs: parseOutputs(raw.outputs) }
				: {}),
			...(typeof raw.temperature === "number"
				? { temperature: raw.temperature }
				: {}),
			...(typeof raw.maxOutputTokens === "number"
				? { maxOutputTokens: raw.maxOutputTokens }
				: {}),
			...(typeof raw.timeoutMs === "number"
				? { timeoutMs: raw.timeoutMs }
				: {}),
		};
		return node;
	}
	return null;
}

function parsePersona(raw: unknown): FlowPersonaSpec | undefined {
	if (!isRecord(raw) || typeof raw.source !== "string") return undefined;
	if (raw.source === "named" && typeof raw.name === "string") {
		return { source: "named", name: raw.name };
	}
	if (raw.source === "dashboard") return { source: "dashboard" };
	if (raw.source === "default") return { source: "default" };
	return undefined;
}

function parseResult(raw: unknown): FlowResultPointer | undefined {
	if (!isRecord(raw) || typeof raw.from !== "string") return undefined;
	return {
		from: raw.from,
		...(typeof raw.path === "string" ? { path: raw.path } : {}),
	};
}

function parseDestinations(
	raw: unknown,
): readonly FlowDestination[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	return raw.filter((item): item is FlowDestination => isRecord(item));
}

/** Coerce a JSON body into a FlowDocument-shaped object (not yet validated). */
export function parseUserFlowDocumentBody(
	body: Record<string, unknown>,
	id: string,
): FlowDocument {
	const nodesRaw = Array.isArray(body.nodes) ? body.nodes : [];
	const nodes = nodesRaw.map((raw, index) => {
		const node = parseNode(raw);
		if (!node) {
			throw new UserFlowValidationError([
				`Node ${index + 1} is invalid; every step needs an id, supported type, and valid tool reference for tool steps`,
			]);
		}
		return node;
	});
	const persona = parsePersona(body.persona);
	const result = parseResult(body.result);
	const destinations = parseDestinations(body.destinations);
	const name =
		typeof body.name === "string" && body.name.trim()
			? body.name.trim()
			: "Untitled flow";
	return {
		id,
		name,
		...(typeof body.description === "string"
			? { description: body.description }
			: {}),
		...(typeof body.icon === "string" && body.icon.trim()
			? { icon: body.icon.trim() }
			: {}),
		...(typeof body.color === "string" && body.color.trim()
			? { color: body.color.trim() }
			: {}),
		...(persona ? { persona } : {}),
		nodes,
		triggers: parseFlowTriggers(body.triggers),
		...(typeof body.revision === "number" ? { revision: body.revision } : {}),
		...(typeof body.projectId === "string" && body.projectId.trim()
			? { projectId: body.projectId.trim() }
			: {}),
		...(result ? { result } : {}),
		...(destinations ? { destinations } : {}),
	};
}
