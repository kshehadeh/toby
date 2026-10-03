import { randomUUID } from "node:crypto";
import { type Tool, tool } from "ai";
import { z } from "zod";
import {
	type FlowToolCatalog,
	catalogConnectedNames,
	catalogToolsList,
	listFlowToolCatalog,
} from "../flows/catalog";
import { saveUserFlowDocument } from "../flows/definition-store";
import type { FlowDocument } from "../flows/document-types";
import { FLOW_TILE_COLORS } from "../flows/flow-colors";
import { FLOW_ICON_SYMBOLS } from "../flows/flow-icons";
import { parseUserFlowDocumentBody } from "../flows/parse-user-flow";
import {
	UserFlowValidationError,
	validateUserFlowDocument,
} from "../flows/validate-user-flow";
import { type UserTool, listUserTools } from "../user-tools/store";

const outputs = z.record(z.string(), z.string()).optional();
const inputs = z
	.record(z.string(), z.object({ const: z.unknown() }))
	.optional();

export const flowDraftSchema = z.object({
	name: z.string().trim().min(1),
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
					type: z.literal("tool_executor"),
					tool: z.union([
						z.object({ moduleName: z.string(), toolName: z.string() }),
						z.object({ standardTool: z.string() }),
						z.object({ userToolId: z.string() }),
					]),
					inputs,
					outputs,
				}),
				z.object({
					id: z.string().min(1),
					type: z.literal("llm_prompter"),
					schema: z.object({ kind: z.literal("markdown") }),
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
};

type FlowCreationResult =
	| { ok: true; dryRun: true; document: FlowDocument }
	| { ok: true; id: string; document: FlowDocument }
	| { ok: false; error: string; issues?: readonly string[] };

export function createFlowAuthoringTools(ctx: {
	readonly dryRun: boolean;
	readonly appliedActions: string[];
}): {
	listFlowAuthoringCatalog: Tool<Record<string, never>, FlowAuthoringCatalog>;
	createFlow: Tool<z.infer<typeof flowDraftSchema>, FlowCreationResult>;
} {
	return {
		listFlowAuthoringCatalog: tool({
			description:
				"Inspect available flow steps before building a flow: plugin tools with input schemas and connection states, saved Script Tools, and supported icons/colors. Does not execute any steps.",
			inputSchema: z.object({}),
			execute: async () => ({
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
			}),
		}),
		createFlow: tool({
			description:
				"Validate and save a new custom Toby flow when the user asks to build/create one. Inspect listFlowAuthoringCatalog first. Tool inputs are fixed constants; an optional markdown LLM step must be last. Home Actions use a dashboard runner destination. Saving does not run tools, scripts, or deliveries. Does not update existing flows.",
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
