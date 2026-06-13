import type { AssembledTurn, PipelineNode, RanTurn } from "../pipeline";
import { runIntegrationChatTurn } from "../run-turn";

export const runModelTurnNode: PipelineNode<AssembledTurn, RanTurn> = {
	name: "run-model-turn",
	async run(input, ctx) {
		const moduleNames = ctx.modules.map((m) => m.name);

		const result = await runIntegrationChatTurn(moduleNames, input.messages, {
			persona: ctx.persona,
			dryRun: ctx.dryRun,
			project: ctx.project,
			askUser: ctx.askUser,
			relevantTools: input.spec?.relevantTools,
			chatWithToolsOptions: ctx.chatWithToolsOptions,
			prebuiltToolCatalog: input.toolCatalog,
		});

		return {
			...input,
			text: result.text,
			toolCalls: result.toolCalls,
			appliedActions: result.appliedActions,
			responseMessages: result.responseMessages,
			usage: result.usage,
			providerMetadata: result.providerMetadata,
		};
	},
};
