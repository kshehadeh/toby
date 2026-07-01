import { type Tool, tool } from "ai";
import { z } from "zod";
import type { ChatEventSink } from "../chat-pipeline/chat-events";
import type { Persona } from "../config/index";
import { runSubAgent } from "./sub-agent";

export type SubAgentToolContext = {
	readonly persona: Persona;
	readonly dryRun: boolean;
	readonly abortSignal?: AbortSignal;
	readonly emit?: ChatEventSink;
	readonly nextSeq?: () => number;
	readonly sessionId?: string;
	/** Sink for applied-action summaries from the sub-agent. */
	readonly appliedActions: string[];
};

export function createSubAgentTool(
	ctx: SubAgentToolContext,
): Record<string, Tool> {
	return {
		delegateToSubAgent: tool({
			description:
				"Delegate a focused sub-task to a sub-agent that has access to tools not available in your current tool set. Use this when you determine you need a tool you don't have. First call tobyListTools to discover available tool names, then call this with the specific tools the sub-agent needs. The sub-agent will complete the task and return results to you. Do NOT use this for tools you already have — call them directly. Do NOT use this for tasks requiring user interaction — use askUser instead.",
			inputSchema: z.object({
				task: z
					.string()
					.min(1)
					.describe(
						"A clear, self-contained description of what the sub-agent should accomplish. Include all necessary details — the sub-agent does not share your conversation history.",
					),
				toolNames: z
					.array(z.string().min(1))
					.min(1)
					.max(10)
					.describe(
						"Exact tool names the sub-agent needs (from tobyListTools). The sub-agent will have access to only these tools.",
					),
				context: z
					.string()
					.optional()
					.describe(
						"Optional additional context to pass to the sub-agent (e.g. conversation excerpt, specific IDs, constraints).",
					),
			}),
			execute: async ({ task, toolNames, context }) => {
				if (ctx.dryRun) {
					const msg = `[dry-run] Would delegate to sub-agent: ${task.slice(0, 100)}`;
					ctx.appliedActions.push(msg);
					return {
						ok: true as const,
						dryRun: true,
						text: msg,
						appliedActions: [msg],
					};
				}

				const result = await runSubAgent({
					persona: ctx.persona,
					dryRun: ctx.dryRun,
					task,
					toolNames,
					context,
					abortSignal: ctx.abortSignal,
					emit: ctx.emit,
					sessionId: ctx.sessionId,
					nextSeq: ctx.nextSeq,
				});

				if (result.appliedActions.length > 0) {
					for (const action of result.appliedActions) {
						ctx.appliedActions.push(action);
					}
				}

				return {
					ok: result.ok,
					text: result.text,
					appliedActions: result.appliedActions,
					...(result.error ? { error: result.error } : {}),
				};
			},
		}),
	};
}

/** Prompt section explaining sub-agent delegation. */
export function subAgentPromptSection(): string {
	return `
## Sub-agent delegation

You have a **delegateToSubAgent** tool for when you need tools outside your current tool set.

When to delegate:
- You need a tool that was not included in your current tool set (e.g. filtered out or from another integration).
- A focused sub-task requires specific tools you don't have direct access to.

When NOT to delegate:
- You already have the tool you need — call it directly.
- The task requires user interaction — use **askUser** instead.
- The task is simple and can be done with your existing tools.

How to delegate:
1. Call **tobyListTools** to discover all available tools across connected integrations.
2. Call **delegateToSubAgent** with a self-contained \`task\` description, the exact \`toolNames\` the sub-agent needs, and optional \`context\`.
3. The sub-agent runs the tools and returns its results as text.
4. Use the returned results to complete the user's request.

Important: The sub-agent does not share your conversation history. Include all necessary details in the \`task\` and \`context\` fields.
`;
}
