import { type Tool, tool } from "ai";
import { z } from "zod";
import * as memory from "./memory-service";
import type { MemorySourceSystem, MemoryType } from "./types";

type MemoryToolsContext = {
	readonly userId: string;
	readonly dryRun: boolean;
	readonly appliedActions: string[];
};

const MEMORY_TYPE_VALUES: [MemoryType, ...MemoryType[]] = [
	"preference",
	"relationship",
	"project",
	"life_event",
	"fact",
	"summary",
];

const SOURCE_SYSTEM_VALUES: [MemorySourceSystem, ...MemorySourceSystem[]] = [
	"gmail",
	"calendar",
	"drive",
	"chat",
	"manual",
	"other",
];

export function createMemoryTools(
	ctx: MemoryToolsContext,
): Record<string, Tool> {
	return {
		memorySearch: tool({
			description:
				"Search the user's personal memory for preferences, relationships, projects, facts, and other stored context. Use this to recall information the user previously shared.",
			inputSchema: z.object({
				query: z
					.string()
					.min(1)
					.describe("Search terms to find relevant memories"),
			}),
			execute: async ({ query }) => {
				if (ctx.dryRun) {
					return { dryRun: true, message: `Would search memory for: ${query}` };
				}
				const results = memory.search(ctx.userId, query);
				return {
					count: results.length,
					memories: results.map((m) => ({
						id: m.id,
						type: m.type,
						subject: m.subject,
						value: m.value,
						confidence: m.confidence,
					})),
				};
			},
		}),

		memoryPropose: tool({
			description:
				"Propose a new memory item to store. The memory subsystem will evaluate sensitivity and confidence before saving. High-confidence normal preferences may be auto-saved; everything else requires user confirmation via memorySave.",
			inputSchema: z.object({
				type: z
					.enum(MEMORY_TYPE_VALUES)
					.describe(
						"Category of memory: preference, relationship, project, life_event, fact, or summary",
					),
				value: z.string().min(1).describe("The memory content to store"),
				subject: z
					.string()
					.optional()
					.describe("Optional subject or topic label"),
				confidence: z
					.number()
					.min(0)
					.max(1)
					.describe(
						"Confidence score from 0 to 1 for how certain this memory is",
					),
				sourceSystem: z
					.enum(SOURCE_SYSTEM_VALUES)
					.describe(
						"Where this memory was observed (gmail, calendar, drive, chat, manual, other)",
					),
				sourceId: z
					.string()
					.optional()
					.describe("ID of the source document/event (e.g. email message ID)"),
				sourceUrl: z
					.string()
					.optional()
					.describe("URL linking back to the source"),
				excerpt: z
					.string()
					.optional()
					.describe("Short excerpt from the source that supports this memory"),
				reason: z.string().min(1).describe("Why this memory is worth storing"),
			}),
			execute: async ({
				type,
				value,
				subject,
				confidence,
				sourceSystem,
				sourceId,
				sourceUrl,
				excerpt,
				reason,
			}) => {
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: `Would propose memory: (${type}) ${value.slice(0, 80)}`,
					};
				}
				const proposal = memory.propose(
					ctx.userId,
					{
						userId: ctx.userId,
						type,
						subject,
						value,
						confidence,
						sensitivity: "normal",
						visibility: "usable_by_ai",
						expiresAt: null,
					},
					{
						system: sourceSystem,
						sourceId,
						sourceUrl,
						excerpt,
					},
					reason,
				);
				if (proposal.status === "accepted") {
					const msg = `Auto-saved memory: (${type}) ${value.slice(0, 60)}`;
					ctx.appliedActions.push(msg);
					return {
						status: "accepted",
						proposalId: proposal.id,
						message: msg,
					};
				}
				return {
					status: "pending",
					proposalId: proposal.id,
					sensitivity: proposal.sensitivity,
					suggestedVisibility: proposal.suggestedVisibility,
					message: `Memory proposed but needs confirmation (sensitivity: ${proposal.sensitivity}). Use memorySave with proposalId to confirm.`,
				};
			},
		}),

		memorySave: tool({
			description:
				"Confirm and save a pending memory proposal. Use after memoryPropose returns a pending status that requires user confirmation.",
			inputSchema: z.object({
				proposalId: z
					.string()
					.describe("The ID of the pending proposal to save"),
			}),
			execute: async ({ proposalId }) => {
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: `Would save proposal ${proposalId}`,
					};
				}
				try {
					const item = memory.save(ctx.userId, proposalId);
					const msg = `Saved memory: (${item.type}) ${item.value.slice(0, 60)}`;
					ctx.appliedActions.push(msg);
					return {
						ok: true,
						memoryId: item.id,
						message: msg,
					};
				} catch (e) {
					return {
						ok: false,
						error: e instanceof Error ? e.message : "Failed to save proposal",
					};
				}
			},
		}),

		memoryForget: tool({
			description:
				"Delete a stored memory item. The user can use this to remove outdated or unwanted memories.",
			inputSchema: z.object({
				memoryId: z.string().describe("The ID of the memory to forget/delete"),
			}),
			execute: async ({ memoryId }) => {
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: `Would forget memory ${memoryId}`,
					};
				}
				try {
					memory.forget(ctx.userId, memoryId);
					const msg = `Forgot memory ${memoryId}`;
					ctx.appliedActions.push(msg);
					return { ok: true, message: msg };
				} catch (e) {
					return {
						ok: false,
						error: e instanceof Error ? e.message : "Failed to forget memory",
					};
				}
			},
		}),

		memoryExplain: tool({
			description:
				"Explain why a memory exists: shows the memory item, its sources, and the audit trail of how it was created/modified.",
			inputSchema: z.object({
				memoryId: z.string().describe("The ID of the memory to explain"),
			}),
			execute: async ({ memoryId }) => {
				try {
					const explanation = memory.explain(ctx.userId, memoryId);
					return {
						item: {
							id: explanation.item.id,
							type: explanation.item.type,
							subject: explanation.item.subject,
							value: explanation.item.value,
							confidence: explanation.item.confidence,
							sensitivity: explanation.item.sensitivity,
							visibility: explanation.item.visibility,
						},
						sources: explanation.sources.map((s) => ({
							system: s.system,
							sourceId: s.sourceId,
							sourceUrl: s.sourceUrl,
							excerpt: s.excerpt,
							observedAt: s.observedAt,
						})),
						auditTrail: explanation.auditTrail.map((a) => ({
							action: a.action,
							detail: a.detail,
							createdAt: a.createdAt,
						})),
					};
				} catch (e) {
					return {
						error: e instanceof Error ? e.message : "Failed to explain memory",
					};
				}
			},
		}),

		memoryRetrieveForTask: tool({
			description:
				"Retrieve memories relevant to a specific task or instruction. Returns a compact context bundle with relevant memories, a summary, and a count of omitted (private/unconfirmed) items.",
			inputSchema: z.object({
				taskDescription: z
					.string()
					.min(1)
					.describe("Description of the task to find relevant memories for"),
				includeUnconfirmed: z
					.boolean()
					.optional()
					.describe(
						"Whether to include memories that require user confirmation (default: false)",
					),
			}),
			execute: async ({ taskDescription, includeUnconfirmed }) => {
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: `Would retrieve memories for task: ${taskDescription.slice(0, 80)}`,
					};
				}
				const bundle = memory.retrieveForTask(ctx.userId, taskDescription, {
					includeUnconfirmed,
				});
				return {
					summary: bundle.summary,
					memories: bundle.memories.map((m) => ({
						id: m.id,
						type: m.type,
						subject: m.subject,
						value: m.value,
						confidence: m.confidence,
					})),
					omitted: bundle.omitted,
				};
			},
		}),
	};
}
