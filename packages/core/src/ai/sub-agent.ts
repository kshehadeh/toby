import { randomUUID } from "node:crypto";
import {
	type LanguageModel,
	type Tool,
	generateText,
	stepCountIs,
	tool,
} from "ai";
import { z } from "zod";
import { awaitWithAbort, throwIfAborted } from "../abort";
import type { ChatEventSink } from "../chat-pipeline/chat-events";
import { loadIntegrationToolBundle } from "../chat-pipeline/tool-bundle-cache";
import type { Persona } from "../config/index";
import { getIntegrationModules } from "../integrations/index";
import { logWithSession } from "../logging/chat-log";
import { createModelForPersona } from "./model-factory";

const SUB_AGENT_MAX_STEPS = 8;

/** Tools the sub-agent must never receive (prevents recursion / interaction). */
const SUB_AGENT_EXCLUDED_TOOLS: ReadonlySet<string> = new Set([
	"delegateToSubAgent",
	"askUser",
]);

const SUB_AGENT_SYSTEM = `You are a focused sub-agent operating within Toby. Your job is to complete a specific task using the tools provided, then return your findings as text.

Rules:
- Complete the task fully using the available tools.
- Do NOT ask questions — make reasonable assumptions and proceed.
- Return a clear, concise text summary of what you did and what you found.
- If a tool fails, note the error and continue or report it.
- Do NOT delegate to other sub-agents.`;

export type SubAgentResult = {
	readonly ok: boolean;
	readonly text: string;
	readonly appliedActions: readonly string[];
	readonly error?: string;
};

export type SubAgentOptions = {
	readonly persona: Persona;
	readonly dryRun: boolean;
	readonly task: string;
	readonly toolNames: readonly string[];
	readonly context?: string;
	readonly abortSignal?: AbortSignal;
	readonly emit?: ChatEventSink;
	readonly sessionId?: string;
	/** Next sequence number for event emission. */
	readonly nextSeq?: () => number;
};

/**
 * Resolve a flat map of {toolName → Tool} from all registered integration modules.
 * Uses the tool-bundle cache so repeated calls within a session are cheap.
 */
async function resolveAllIntegrationTools(dryRun: boolean): Promise<{
	readonly tools: Record<string, Tool>;
	readonly toolIntegrationLabels: Record<string, string>;
	readonly allActions: string[];
}> {
	const modules = getIntegrationModules();
	const tools: Record<string, Tool> = {};
	const toolIntegrationLabels: Record<string, string> = {};
	const allActions: string[] = [];

	for (const m of modules) {
		if (!m.createChatTools) continue;
		try {
			const bundle = await loadIntegrationToolBundle([m], { dryRun });
			for (const [name, t] of Object.entries(bundle.tools)) {
				if (!tools[name]) {
					tools[name] = t;
					toolIntegrationLabels[name] = m.displayName;
				}
			}
		} catch {
			// Module may not be connected; skip silently.
		}
	}

	return { tools, toolIntegrationLabels, allActions };
}

/** Wrap tools with lifecycle event emission for the sub-agent. */
function wrapToolsWithEvents(
	tools: Record<string, Tool>,
	emit: ChatEventSink | undefined,
	nextSeq: () => number,
	abortSignal?: AbortSignal,
): Record<string, Tool> {
	if (!emit) return tools;
	const wrapped: Record<string, Tool> = {};
	for (const [name, t] of Object.entries(tools)) {
		const execute = t.execute;
		if (!execute) {
			wrapped[name] = t;
			continue;
		}
		wrapped[name] = {
			...t,
			execute: async (input, toolOptions) => {
				const blockKey = `sub-${randomUUID()}`;
				const args =
					input && typeof input === "object" && !Array.isArray(input)
						? (input as Record<string, unknown>)
						: {};
				throwIfAborted(abortSignal);
				emit({
					type: "tool_call_start",
					blockKey,
					seq: nextSeq(),
					toolName: name,
					args,
				});
				const startMs = Date.now();
				try {
					const result = await awaitWithAbort(
						execute(input as never, toolOptions as never),
						abortSignal,
					);
					emit({
						type: "tool_call_complete",
						blockKey,
						seq: nextSeq(),
						toolName: name,
						args,
						result,
						durationMs: Date.now() - startMs,
					});
					return result;
				} catch (error) {
					emit({
						type: "tool_call_complete",
						blockKey,
						seq: nextSeq(),
						toolName: name,
						args,
						result: undefined,
						error,
						durationMs: Date.now() - startMs,
					});
					throw error;
				}
			},
		};
	}
	return wrapped;
}

export async function runSubAgent(
	options: SubAgentOptions,
): Promise<SubAgentResult> {
	const { persona, dryRun, task, toolNames, context, abortSignal, emit } =
		options;
	const sid = options.sessionId ?? null;

	const requestedLower = new Set(toolNames.map((n) => n.trim().toLowerCase()));

	if (requestedLower.size === 0) {
		return {
			ok: false,
			text: "",
			appliedActions: [],
			error:
				"No tool names provided. Specify at least one tool for the sub-agent.",
		};
	}

	logWithSession(sid, undefined, "info", "turn", "subagent_start", {
		task: task.slice(0, 200),
		requestedTools: [...requestedLower],
	});

	const { tools: allTools, toolIntegrationLabels } =
		await resolveAllIntegrationTools(dryRun);

	// Filter to requested tools, excluding forbidden ones.
	const selectedTools: Record<string, Tool> = {};
	for (const [name, t] of Object.entries(allTools)) {
		if (SUB_AGENT_EXCLUDED_TOOLS.has(name)) continue;
		if (requestedLower.has(name.toLowerCase())) {
			selectedTools[name] = t;
		}
	}

	// Always give the sub-agent access to current date-time.
	if (!selectedTools.getCurrentDateTime) {
		selectedTools.getCurrentDateTime = tool({
			description:
				"Get the current local datetime, UTC datetime, timezone, and Unix milliseconds.",
			inputSchema: z.object({}),
			execute: async () => {
				const { getCurrentDateTimeInfo } = await import("./current-datetime");
				return getCurrentDateTimeInfo();
			},
		});
	}

	const foundNames = Object.keys(selectedTools).filter(
		(n) => !SUB_AGENT_EXCLUDED_TOOLS.has(n) && n !== "getCurrentDateTime",
	);
	const missing = toolNames.filter(
		(n) =>
			!foundNames.some((f) => f.toLowerCase() === n.trim().toLowerCase()) &&
			n.trim().toLowerCase() !== "getcurrentdatetime",
	);

	if (foundNames.length === 0) {
		const available = Object.keys(allTools).filter(
			(n) => !SUB_AGENT_EXCLUDED_TOOLS.has(n),
		);
		return {
			ok: false,
			text: "",
			appliedActions: [],
			error: `None of the requested tools were found. Requested: ${toolNames.join(", ")}. Available: ${available.join(", ")}`,
		};
	}

	const nextSeq =
		options.nextSeq ??
		(() => {
			let s = 0;
			return () => {
				s += 1;
				return s;
			};
		})();

	const toolsForModel = wrapToolsWithEvents(
		selectedTools,
		emit,
		nextSeq,
		abortSignal,
	);

	const model = createModelForPersona(persona);

	const toolListForPrompt = foundNames
		.map((n) => {
			const desc =
				typeof selectedTools[n]?.description === "string"
					? (selectedTools[n] as { description: string }).description
					: "(no description)";
			const label = toolIntegrationLabels[n] ?? "Toby";
			return `- ${n} (${label}): ${desc}`;
		})
		.join("\n");

	const userPrompt = `Task:
${task.trim()}
${context?.trim() ? `\nAdditional context:\n${context.trim()}\n` : ""}
Available tools:
${toolListForPrompt}

Complete the task now using the tools above. Return a clear summary of your findings and any actions taken.`;

	try {
		const result = await awaitWithAbort(
			generateText({
				model,
				system: SUB_AGENT_SYSTEM,
				prompt: userPrompt,
				tools: toolsForModel,
				stopWhen: stepCountIs(SUB_AGENT_MAX_STEPS),
				abortSignal,
			}),
			abortSignal,
		);

		throwIfAborted(abortSignal);

		const toolCalls = result.steps.flatMap((step) =>
			step.toolCalls.map((tc) => tc.toolName),
		);

		// Collect applied actions from integration tool bundles.
		// Each tool's execute may have pushed to an internal actions array
		// via the IntegrationChatTools pattern, but those are per-bundle.
		// We log what was called instead.
		const appliedActions: string[] = [...new Set(toolCalls)].map(
			(name) => `Sub-agent called: ${name}`,
		);

		logWithSession(sid, undefined, "info", "turn", "subagent_end", {
			durationMs: 0,
			toolCalls,
			foundTools: foundNames,
			missingTools: missing,
		});

		return {
			ok: true,
			text: result.text.trim(),
			appliedActions,
			...(missing.length > 0
				? { error: `Tools not found: ${missing.join(", ")}` }
				: {}),
		};
	} catch (error) {
		logWithSession(sid, undefined, "warn", "turn", "subagent_error", {
			error: error instanceof Error ? error.message : String(error),
		});
		return {
			ok: false,
			text: "",
			appliedActions: [],
			error:
				error instanceof Error
					? error.message
					: "Sub-agent failed with an unknown error.",
		};
	}
}
