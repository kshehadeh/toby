import { type Tool, tool } from "ai";
import { z } from "zod";
import {
	getAutomation,
	listAutomations,
	saveAutomation,
	validateAutomationDraft,
} from "../automations/store";
import { automationCatalog, automationDraftSchema } from "../automations/types";
import { listFlowRecords } from "../flows/definition-store";

export function createAutomationAuthoringTools(ctx: {
	dryRun: boolean;
	appliedActions: string[];
}): Record<string, Tool> {
	return {
		listAutomationCatalog: tool({
			description:
				"Inspect supported macOS event triggers, saved automations, and custom flows. Native triggers require Toby.app to be running. Does not execute work.",
			inputSchema: z.object({}),
			execute: async () => ({
				...automationCatalog,
				automations: listAutomations(),
				flows: listFlowRecords()
					.filter((f) => !f.builtin)
					.map((f) => ({
						id: f.id,
						name: f.name,
						destinations: f.document.destinations ?? [],
					})),
			}),
		}),
		createAutomation: tool({
			description:
				"Save a flow automation for return after idle or Mac wake. Inspect listAutomationCatalog first. Enable only when the user has requested automatic execution of the selected flow and its delivery targets. Creation never runs the flow.",
			inputSchema: automationDraftSchema,
			execute: async (draft) => {
				try {
					validateAutomationDraft(draft);
					if (ctx.dryRun) return { ok: true, dryRun: true, draft };
					const a = saveAutomation(draft);
					ctx.appliedActions.push(`Created automation ${a.name} (${a.id})`);
					return { ok: true, automation: a };
				} catch (error) {
					return { ok: false, error: String(error) };
				}
			},
		}),
		updateAutomation: tool({
			description:
				"Replace an existing automation definition using its current revision from listAutomationCatalog. Review flow/delivery changes with the user before enabling new actions. Does not run the flow.",
			inputSchema: z.object({
				id: z.string(),
				revision: z.number().int().positive(),
				definition: automationDraftSchema,
			}),
			execute: async ({ id, revision, definition }) => {
				try {
					const existing = getAutomation(id);
					if (!existing) return { ok: false, error: "Automation not found" };
					if (existing.revision !== revision)
						throw new Error("Automation changed; reload before saving");
					validateAutomationDraft(definition);
					if (ctx.dryRun) return { ok: true, dryRun: true, definition };
					const a = saveAutomation(definition, id, revision);
					ctx.appliedActions.push(`Updated automation ${a.name} (${a.id})`);
					return { ok: true, automation: a };
				} catch (error) {
					return { ok: false, error: String(error) };
				}
			},
		}),
	};
}
