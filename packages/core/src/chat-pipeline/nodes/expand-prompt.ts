import { throwIfAborted } from "../../abort";
import { wrapUserPromptWithPretreatment } from "../../ai/pretreatment";
import type { ExpandedTurn, InitedTurn, PipelineNode } from "../pipeline";
import { createPrepId, formatPrepEndDetail } from "../prep-format";
import { buildSelectionTranscriptEntries } from "../selection-transcript";

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

		throwIfAborted(ctx.abortSignal);

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

		if (wrapResult.spec !== null) {
			const notices = buildSelectionTranscriptEntries({
				relevantSkills: wrapResult.spec.relevantSkills,
				allToolNames: input.toolCatalog.allToolNames,
				toolIntegrationLabels: input.toolCatalog.toolIntegrationLabels,
				relevantTools: wrapResult.spec.relevantTools,
				pretreatmentRan: true,
			});
			for (const notice of notices) {
				if (notice.kind !== "notice") {
					continue;
				}
				ctx.emit({
					type: "transcript_notice",
					seq: ctx.nextSeq(),
					text: notice.text,
					...(notice.tone !== undefined ? { tone: notice.tone } : {}),
				});
			}
		}

		return {
			...input,
			effectiveText: wrapResult.content,
			spec: wrapResult.spec,
			prepId,
		};
	},
};
