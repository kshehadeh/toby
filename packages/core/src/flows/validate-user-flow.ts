import { isBuiltinFlowId } from "./builtins";
import type {
	FlowDestination,
	FlowDocument,
	StoredFlowNode,
	StoredLlmPrompterNode,
	StoredToolExecutorNode,
} from "./document-types";
import type { FlowInputSource, ToolRef } from "./types";

export type FlowCatalogTool = {
	readonly moduleName: string;
	readonly toolName: string;
	readonly displayName?: string;
	readonly description?: string;
	readonly readOnly?: boolean;
	readonly standardTool?: string;
	readonly inputSchema: {
		readonly type?: string;
		readonly properties?: Readonly<Record<string, unknown>>;
		readonly required?: readonly string[];
	};
};

export type ValidateUserFlowOptions = {
	readonly tools: readonly FlowCatalogTool[];
	readonly connectedModules: readonly string[];
};

export class UserFlowValidationError extends Error {
	readonly issues: readonly string[];

	constructor(issues: readonly string[]) {
		super(issues.join("; "));
		this.name = "UserFlowValidationError";
		this.issues = issues;
	}
}

const DEFAULT_DESTINATIONS: readonly FlowDestination[] = [
	{ type: "modal" },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isConstSource(
	source: FlowInputSource,
): source is { readonly const: unknown } {
	return isRecord(source) && "const" in source && !("from" in source);
}

function resolveCatalogTool(
	tool: ToolRef,
	tools: readonly FlowCatalogTool[],
): FlowCatalogTool | undefined {
	if ("standardTool" in tool) {
		const id = tool.standardTool.trim();
		if (!id) return undefined;
		return tools.find((t) => t.standardTool === id);
	}
	const moduleName = tool.moduleName.trim();
	const toolName = tool.toolName.trim();
	if (!moduleName || !toolName) return undefined;
	return tools.find(
		(t) => t.moduleName === moduleName && t.toolName === toolName,
	);
}

function constIsPresent(value: unknown): boolean {
	if (value === undefined || value === null) return false;
	if (typeof value === "string") return value.trim().length > 0;
	if (Array.isArray(value)) return value.length > 0;
	return true;
}

function validateToolNode(
	node: StoredToolExecutorNode,
	options: ValidateUserFlowOptions,
	issues: string[],
): void {
	const inputs = node.inputs ?? {};
	for (const [name, source] of Object.entries(inputs)) {
		if (!isConstSource(source)) {
			issues.push(
				`Node "${node.id}" input "${name}" must be an author-time constant (runtime bag wiring is not allowed)`,
			);
		}
	}

	const catalogTool = resolveCatalogTool(node.tool, options.tools);
	if (!catalogTool) {
		const label =
			"standardTool" in node.tool
				? node.tool.standardTool
				: `${node.tool.moduleName}.${node.tool.toolName}`;
		issues.push(`Node "${node.id}" references unknown tool "${label}"`);
		return;
	}

	const required = catalogTool.inputSchema.required ?? [];
	for (const field of required) {
		const source = inputs[field];
		if (!source || !isConstSource(source) || !constIsPresent(source.const)) {
			issues.push(
				`Node "${node.id}" is missing required input "${field}" for ${catalogTool.moduleName}.${catalogTool.toolName}`,
			);
		}
	}
}

function validateLlmNode(
	node: StoredLlmPrompterNode,
	index: number,
	nodeCount: number,
	issues: string[],
): void {
	if (index !== nodeCount - 1) {
		issues.push(
			`LLM Prompter node "${node.id}" must be the last step (v1 does not map model output into later tools)`,
		);
	}
	if (node.schema.kind !== "markdown") {
		issues.push(`LLM Prompter node "${node.id}" must use the markdown schema`);
	}
	if (!node.systemPrompt.trim() && !node.userPrompt.trim()) {
		issues.push(`LLM Prompter node "${node.id}" needs a system or user prompt`);
	}
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function validateDestination(
	destination: FlowDestination,
	index: number,
	connected: ReadonlySet<string>,
	issues: string[],
): void {
	const label = `Destination ${index + 1}`;
	if (destination.type === "modal") {
		return;
	}
	if (destination.type === "email") {
		if (!connected.has("email")) {
			issues.push(`${label}: Email is not connected`);
		}
		const to = destination.to ?? [];
		if (to.length === 0 || to.some((addr) => !isNonEmptyString(addr))) {
			issues.push(`${label}: Email needs at least one recipient`);
		}
		if (!isNonEmptyString(destination.subject)) {
			issues.push(`${label}: Email needs a subject`);
		}
		return;
	}
	if (destination.type === "slack") {
		if (!connected.has("slack")) {
			issues.push(`${label}: Slack is not connected`);
		}
		if (!isNonEmptyString(destination.channel)) {
			issues.push(`${label}: Slack needs a channel`);
		}
		return;
	}
	issues.push(
		`${label}: Unknown destination type "${(destination as { type: string }).type}"`,
	);
}

function normalizeDestination(
	raw: unknown,
	issues: string[],
	index: number,
): FlowDestination | null {
	if (!isRecord(raw) || typeof raw.type !== "string") {
		issues.push(`Destination ${index + 1} is invalid`);
		return null;
	}
	if (raw.type === "modal") {
		return { type: "modal" };
	}
	if (raw.type === "email") {
		const to = Array.isArray(raw.to)
			? raw.to.filter((item): item is string => typeof item === "string")
			: [];
		const cc = Array.isArray(raw.cc)
			? raw.cc.filter((item): item is string => typeof item === "string")
			: undefined;
		return {
			type: "email",
			to,
			subject: typeof raw.subject === "string" ? raw.subject : "",
			...(cc && cc.length > 0 ? { cc } : {}),
		};
	}
	if (raw.type === "slack") {
		return {
			type: "slack",
			channel: typeof raw.channel === "string" ? raw.channel : "",
		};
	}
	issues.push(
		`Destination ${index + 1}: Unknown destination type "${raw.type}"`,
	);
	return null;
}

/**
 * Validate and normalize a user-authored flow.
 * Built-in documents must not go through this path.
 */
export function validateUserFlowDocument(
	document: FlowDocument,
	options: ValidateUserFlowOptions,
): FlowDocument {
	const issues: string[] = [];
	const id = document.id.trim();
	const name = document.name.trim();

	if (!id) {
		issues.push("Flow must have an id");
	} else if (isBuiltinFlowId(id) || id.startsWith("dashboard.")) {
		issues.push(`Id "${id}" is reserved for built-in flows`);
	}
	if (!name) {
		issues.push("Flow must have a name");
	}
	if (document.nodes.length === 0) {
		issues.push("Flow must have at least one node");
	}

	const nodeIds = new Set<string>();
	document.nodes.forEach((node: StoredFlowNode, index) => {
		if (!node.id.trim()) {
			issues.push(`Node ${index + 1} has an empty id`);
			return;
		}
		if (nodeIds.has(node.id)) {
			issues.push(`Duplicate node id "${node.id}"`);
		}
		nodeIds.add(node.id);

		if (node.type === "tool_executor") {
			validateToolNode(node, options, issues);
		} else if (node.type === "llm_prompter") {
			validateLlmNode(node, index, document.nodes.length, issues);
		} else {
			issues.push(
				`Node "${(node as StoredFlowNode).id}" has unsupported type "${(node as { type: string }).type}"`,
			);
		}
	});

	const connected = new Set(options.connectedModules);
	const rawDestinations = document.destinations ?? DEFAULT_DESTINATIONS;
	const destinations: FlowDestination[] = [];
	rawDestinations.forEach((dest, index) => {
		const normalized = normalizeDestination(dest, issues, index);
		if (normalized) {
			destinations.push(normalized);
			validateDestination(normalized, index, connected, issues);
		}
	});
	if (destinations.length === 0 && issues.length === 0) {
		destinations.push({ type: "modal" });
	}

	if (document.result && !document.result.from.trim()) {
		issues.push("Result pointer needs a bag key");
	}

	if (issues.length > 0) {
		throw new UserFlowValidationError(issues);
	}

	return {
		...document,
		id,
		name,
		destinations,
		...(document.result
			? {
					result: {
						from: document.result.from.trim(),
						...(document.result.path !== undefined
							? { path: document.result.path }
							: {}),
					},
				}
			: {}),
	};
}

export function defaultUserFlowDestinations(): readonly FlowDestination[] {
	return DEFAULT_DESTINATIONS;
}
