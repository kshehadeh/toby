import { wrapUserPromptWithPretreatment } from "../../ai/pretreatment";
import type { ExpandedTurn, InitedTurn, PipelineNode } from "../pipeline";
import { createPrepId, formatPrepEndDetail } from "../prep-format";

export const expandPromptNode: PipelineNode<InitedTurn, ExpandedTurn> = {
	name: "expand-prompt",
	async run(input, ctx) {
		const prepId = createPrepId(input.willPretreat);

		if (prepId) {
			ctx.emit({
				type: "prep_start",
				id: prepId,
				seq: ctx.nextSeq(),
				header: "Prompt preparation",
			});
			if (ctx.onStatusLine) {
				await ctx.onStatusLine("Routing skills and tools…");
			}
		}

		const wrapResult = await wrapUserPromptWithPretreatment({
			priorMessages: input.isFirstTurn ? null : [...input.priorMessages],
			rawUserText: input.rawUserText,
			integrationLabels: input.integrationLabel,
			isFirstTurn: input.isFirstTurn,
			priorPretreatment: input.priorPretreatment,
			persona: ctx.persona,
			skillsCatalog: [...input.localSkills],
			toolsCatalogText: input.toolCatalog.catalogText,
			allowedToolNamesLower: input.toolCatalog.allowedToolNamesLower,
			toolIntegrationLabels: input.toolCatalog.toolIntegrationLabels,
			abortSignal: ctx.abortSignal,
			routingIndex: input.routingIndex,
		});

		if (prepId) {
			ctx.emit({
				type: "prep_end",
				id: prepId,
				seq: ctx.nextSeq(),
				detail: formatPrepEndDetail(
					input.rawUserText,
					wrapResult.content,
					wrapResult.spec,
				),
			});
		}

		return {
			...input,
			effectiveText: wrapResult.content,
			spec: wrapResult.spec,
			prepId,
		};
	},
};
