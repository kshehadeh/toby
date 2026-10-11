import { randomUUID } from "node:crypto";
import { type Tool, tool } from "ai";
import { z } from "zod";
import {
	type FlowToolCatalog,
	catalogConnectedNames,
	catalogToolsList,
	listFlowToolCatalog,
} from "../flows/catalog";
import {
	getFlowRecord,
	listFlowRecords,
	saveUserFlowDocument,
} from "../flows/definition-store";
import type { FlowDocument } from "../flows/document-types";
import { FLOW_TILE_COLORS } from "../flows/flow-colors";
import { FLOW_ICON_SYMBOLS } from "../flows/flow-icons";
import { parseUserFlowDocumentBody } from "../flows/parse-user-flow";
import {
	folderTriggerSchema,
	nativeTriggerCatalog,
} from "../flows/triggers/native-types";
import { flowTriggerSchema } from "../flows/triggers/types";
import {
	UserFlowValidationError,
	validateUserFlowDocument,
} from "../flows/validate-user-flow";
import { nativeAppRequest } from "../native-app/client";
import { type UserTool, listUserTools } from "../user-tools/store";

const reference = z
	.object({ from: z.string().min(1), path: z.string().optional() })
	.strict();

const outputs = z.record(z.string(), z.string()).optional();
const inputs = z
	.record(
		z.string(),
		z.union([
			z.object({ const: z.unknown() }).strict(),
			z
				.object({ from: z.string().min(1), path: z.string().optional() })
				.strict(),
		]),
	)
	.optional();

export const flowDraftSchema = z.object({
	name: z.string().trim().min(1),
	triggers: z.array(flowTriggerSchema).max(32).optional(),
	projectId: z.string().optional(),
	description: z.string().optional(),
	icon: z.enum(FLOW_ICON_SYMBOLS).optional(),
	color: z.enum(FLOW_TILE_COLORS).optional(),
	persona: z
		.discriminatedUnion("source", [
			z.object({ source: z.literal("default") }),
			z.object({ source: z.literal("dashboard") }),
			z.object({ source: z.literal("named"), name: z.string().min(1) }),
		])
		.optional(),
	nodes: z
		.array(
			z.discriminatedUnion("type", [
				z.object({
					id: z.string().min(1),
					type: z.literal("agent_task"),
					systemPrompt: z.string().optional(),
					userPrompt: z.string().min(1),
					inputs,
					outputs,
				}),
				z.object({
					id: z.string().min(1),
					type: z.literal("tool_executor"),
					tool: z.union([
						z.object({ moduleName: z.string(), toolName: z.string() }),
						z.object({ standardTool: z.string() }),
						z.object({ userToolId: z.string() }),
					]),
					inputs,
					when: reference.optional(),
					outputs,
				}),
				z.object({
					id: z.string().min(1),
					type: z.literal("llm_prompter"),
					schema: z.discriminatedUnion("kind", [
						z.object({ kind: z.literal("markdown") }),
						z.object({
							kind: z.literal("object"),
							fields: z.record(
								z.string(),
								z
									.object({
										type: z.enum(["string", "boolean", "number"]),
										description: z.string().optional(),
									})
									.strict(),
							),
						}),
					]),
					systemPrompt: z.string(),
					userPrompt: z.string(),
					outputs,
					promptHelpers: z
						.object({
							composePersona: z.boolean().optional(),
							appendCurrentDateTime: z.boolean().optional(),
						})
						.optional(),
				}),
			]),
		)
		.min(1),
	result: z
		.object({ from: z.string().min(1), path: z.string().optional() })
		.optional(),
	destinations: z
		.array(
			z.discriminatedUnion("type", [
				z.object({ type: z.literal("modal") }),
				z.object({
					type: z.literal("dashboard"),
					color: z.enum(["neutral", ...FLOW_TILE_COLORS]).optional(),
					variant: z.enum(["runner", "informational"]),
					refresh: z.enum(["asNeeded", "manual"]).optional(),
				}),
				z.object({
					type: z.literal("email"),
					to: z.array(z.string()).min(1),
					subject: z.string().min(1),
					cc: z.array(z.string()).optional(),
				}),
				z.object({ type: z.literal("slack"), channel: z.string().min(1) }),
			]),
		)
		.optional(),
});

type FlowAuthoringCatalog = FlowToolCatalog & {
	scriptTools: (Pick<
		UserTool,
		"name" | "description" | "language" | "inputNames" | "outputKind"
	> & { userToolId: string })[];
	icons: typeof FLOW_ICON_SYMBOLS;
	colors: typeof FLOW_TILE_COLORS;
	triggers: readonly { type: string; name: string }[];
	flows: readonly { id: string; name: string; revision: number }[];
};

type FlowCreationResult =
	| { ok: true; dryRun: true; document: FlowDocument }
	| { ok: true; id: string; document: FlowDocument }
	| { ok: false; error: string; issues?: readonly string[] };

const updateFlowSchema = z.object({
	id: z.string().min(1),
	revision: z.number().int().nonnegative(),
	definition: flowDraftSchema,
});

export function createFlowAuthoringTools(ctx: {
	readonly dryRun: boolean;
	readonly appliedActions: string[];
}): {
	listFlowAuthoringCatalog: Tool<Record<string, never>, FlowAuthoringCatalog>;
	createFlow: Tool<z.infer<typeof flowDraftSchema>, FlowCreationResult>;
	updateFlow: Tool<z.infer<typeof updateFlowSchema>, FlowCreationResult>;
	inspectFlow: Tool<{ id: string }, { document: FlowDocument | null }>;
	inspectFlowFolder: Tool<z.infer<typeof folderTriggerSchema>, unknown>;
} {
	return {
		inspectFlow: tool({
			description:
				"Read a Flow's complete definition and revision before editing.",
			inputSchema: z.object({ id: z.string() }),
			execute: async ({ id }) => ({
				document: getFlowRecord(id)?.document ?? null,
			}),
		}),
		inspectFlowFolder: tool({
			description:
				"Inspect a folder before adding a Flow file trigger. Narrow warned folders or obtain explicit acceptance before allowing a large folder.",
			inputSchema: folderTriggerSchema,
			execute: async (source): Promise<unknown> =>
				nativeAppRequest("flows/triggers/folder-assessment", {
					body: { id: "assessment", ...source },
					launch: false,
					timeoutMs: 15000,
				}),
		}),
		updateFlow: tool({
			description:
				"Replace a Flow using its current revision and complete definition from inspectFlow. Saving enabled automatic triggers permits future execution; enable only when requested. Does not run the Flow immediately.",
			inputSchema: updateFlowSchema,
			execute: async ({ id, revision, definition }) => {
				try {
					const existing = getFlowRecord(id);
					if (!existing || existing.builtin)
						return { ok: false, error: "Custom flow not found" };
					if (revision !== (existing.document.revision ?? 0))
						return {
							ok: false,
							error: "Flow changed; inspect it again before editing",
						};
					const catalog = await listFlowToolCatalog();
					const document = validateUserFlowDocument(
						parseUserFlowDocumentBody({ ...definition, revision }, id),
						{
							tools: catalogToolsList(catalog),
							connectedModules: catalogConnectedNames(catalog),
						},
					);
					if (ctx.dryRun) return { ok: true, dryRun: true, document };
					const record = saveUserFlowDocument(document);
					ctx.appliedActions.push(`Updated flow ${record.name} (${id})`);
					return { ok: true, id, document: record.document };
				} catch (error) {
					return { ok: false, error: String(error) };
				}
			},
		}),
		listFlowAuthoringCatalog: tool({
			description:
				"Inspect available flow steps before building a flow: plugin tools with input schemas and connection states, saved Script Tools, and supported icons/colors. Does not execute any steps.",
			inputSchema: z.object({}),
			execute: async (): Promise<FlowAuthoringCatalog> => ({
				...(await listFlowToolCatalog()),
				scriptTools: listUserTools().map((script) => ({
					userToolId: script.id,
					name: script.name,
					description: script.description,
					language: script.language,
					inputNames: script.inputNames,
					outputKind: script.outputKind,
				})),
				icons: FLOW_ICON_SYMBOLS,
				colors: FLOW_TILE_COLORS,
				triggers: [
					{ type: "manual", name: "Manually" },
					{ type: "home.action", name: "Home Screen Action" },
					{ type: "dashboard.refresh", name: "Home refresh" },
					{ type: "schedule", name: "On a schedule" },
					...nativeTriggerCatalog.triggers,
				],
				flows: listFlowRecords()
					.filter((f) => !f.builtin)
					.map((f) => ({
						id: f.id,
						name: f.name,
						revision: f.document.revision ?? 0,
					})),
			}),
		}),
		createFlow: tool({
			description:
				"Validate and save a new custom Toby flow when the user asks to build/create one. Inspect listFlowAuthoringCatalog first. Tool inputs use constants, trigger context references, or previous step outputs. An optional LLM step returns markdown or named text/boolean/number fields and may be followed by actions. Action when references run only for boolean true; false skips. Home Actions use a home.action trigger paired with a dashboard runner destination; saving either configures both. Saving does not run tools, scripts, or deliveries. Use updateFlow to edit existing flows. Home refresh uses dashboard.refresh paired with a dashboard informational destination; saving either configures both. Home action and refresh cannot coexist. Triggers include manual, home.action (Home Screen Action), dashboard.refresh (Home refresh), schedule (cron plus timezone), and native events. Use agent_task for tool-using prompts. Only enable automatic triggers when the user requested automatic execution; saving can schedule future work.",
			inputSchema: flowDraftSchema,
			execute: async (draft) => {
				try {
					const catalog = await listFlowToolCatalog();
					const document = validateUserFlowDocument(
						parseUserFlowDocumentBody(draft, `flow.${randomUUID()}`),
						{
							tools: catalogToolsList(catalog),
							connectedModules: catalogConnectedNames(catalog),
						},
					);
					if (ctx.dryRun) {
						return { ok: true, dryRun: true, document };
					}
					const record = saveUserFlowDocument(document);
					ctx.appliedActions.push(`Created flow ${record.name} (${record.id})`);
					return { ok: true, id: record.id, document: record.document };
				} catch (error) {
					return {
						ok: false,
						error: error instanceof Error ? error.message : String(error),
						...(error instanceof UserFlowValidationError
							? { issues: error.issues }
							: {}),
					};
				}
			},
		}),
	};
}
