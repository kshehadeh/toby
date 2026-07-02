import crypto from "node:crypto";
import { shouldPretreat } from "../../ai/pretreatment";
import { loadProjectSkills } from "../../projects/index";
import { warmRoutingIndex } from "../../routing/index";
import {
	computeSkillCatalogSignature,
	formatSkillsCatalogForPrompt,
	loadLocalSkills,
} from "../../skills/index";
import { formatScopeLabel } from "../format-scope-label";
import type {
	InitedTurn,
	PipelineNode,
	TurnContext,
	TurnRequest,
} from "../pipeline";
import { buildToolsCatalogForPretreatment } from "../run-turn";

function sha256CatalogDigest(catalogText: string): string {
	return crypto
		.createHash("sha256")
		.update(catalogText)
		.digest("base64")
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "")
		.slice(0, 20);
}

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

		const localSkills = loadLocalSkills().filter((s) => s.enabled !== false);
		const projectSkills = ctx.project ? loadProjectSkills(ctx.project) : [];
		const allSkills = [...localSkills, ...projectSkills];

		if (onStatus) {
			const total = allSkills.length;
			const parts = [`${localSkills.length} global`];
			if (projectSkills.length > 0) {
				parts.push(`${projectSkills.length} project`);
			}
			await onStatus(`Skills catalog: ${parts.join(" + ")} (${total} total).`);
			await onStatus("Loading tool catalog…");
		}

		const toolCatalog = await buildToolsCatalogForPretreatment(ctx.modules, {
			dryRun: ctx.dryRun,
			persona: ctx.persona,
			project: ctx.project,
		});

		if (onStatus) {
			await onStatus(
				`Tool catalog: ${toolCatalog.allowedToolNamesLower.size} tools available.`,
			);
		}

		const skillsCatalogText = formatSkillsCatalogForPrompt(allSkills);
		const skillsCatalogSignature = computeSkillCatalogSignature(allSkills);
		const toolsCatalogSignature = sha256CatalogDigest(toolCatalog.catalogText);

		let routingIndex = null;
		const warm = await warmRoutingIndex({
			persona: ctx.persona,
			toolsCatalogText: toolCatalog.catalogText,
			skillsCatalogText,
			toolsCatalogSignature,
			skillsCatalogSignature,
			abortSignal: ctx.abortSignal,
		});
		routingIndex = warm.index;
		if (onStatus && warm.rebuilt) {
			await onStatus("Indexing tools for routing…");
		}

		const willPretreat =
			input.rawUserText.trim().length > 0 &&
			shouldPretreat(input.priorMessages, input.rawUserText, input.isFirstTurn);

		return {
			...input,
			localSkills: allSkills,
			toolCatalog,
			willPretreat,
			integrationLabel,
			routingIndex,
		};
	},
};
