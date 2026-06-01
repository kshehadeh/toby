import { shouldPretreat } from "../../ai/pretreatment";
import { loadLocalSkills } from "../../skills/index";
import { formatScopeLabel } from "../format-scope-label";
import type {
	InitedTurn,
	PipelineNode,
	TurnContext,
	TurnRequest,
} from "../pipeline";
import { buildToolsCatalogForPretreatment } from "../run-turn";

export const turnInitNode: PipelineNode<TurnRequest, InitedTurn> = {
	name: "turn-init",
	async run(input, ctx) {
		const integrationLabel = formatScopeLabel(ctx.modules);
		const onStatus = ctx.onStatusLine;

		if (onStatus) {
			await onStatus(`Scope: ${integrationLabel}`);
			await onStatus(`Persona: ${ctx.persona.name}`);
			await onStatus("Loading local skills catalog…");
		}

		const localSkills = loadLocalSkills();

		if (onStatus) {
			await onStatus(`Local skills catalog: ${localSkills.length} available.`);
			await onStatus("Loading tool catalog…");
		}

		const toolCatalog = await buildToolsCatalogForPretreatment(ctx.modules, {
			dryRun: ctx.dryRun,
			persona: ctx.persona,
		});

		if (onStatus) {
			await onStatus(
				`Tool catalog: ${toolCatalog.allowedToolNamesLower.size} tools available.`,
			);
		}

		const willPretreat =
			input.rawUserText.trim().length > 0 &&
			shouldPretreat(input.priorMessages, input.rawUserText, input.isFirstTurn);

		return {
			...input,
			localSkills,
			toolCatalog,
			willPretreat,
			integrationLabel,
		};
	},
};
