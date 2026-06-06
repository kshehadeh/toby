import { randomUUID } from "node:crypto";
import type { CoreMessage } from "../../ai/chat";
import {
	injectSkillBodiesIntoFirstSystemMessage,
	prepareChatSessionMessages,
} from "../../prepare-messages";
import type { AssembledTurn, ExpandedTurn, PipelineNode } from "../pipeline";

export const assembleMessagesNode: PipelineNode<ExpandedTurn, AssembledTurn> = {
	name: "assemble-messages",
	async run(input, ctx) {
		let messages: CoreMessage[];

		if (input.isFirstTurn) {
			if (ctx.onStatusLine) {
				await ctx.onStatusLine("Fetching integration connection context…");
			}
			messages = await prepareChatSessionMessages(
				ctx.modules,
				ctx.persona,
				input.effectiveText,
				ctx.onStatusLine,
			);
		} else {
			const mergeLifecycleId = randomUUID();
			ctx.emit({
				type: "lifecycle_start",
				id: mergeLifecycleId,
				seq: ctx.nextSeq(),
				header: "Updating session messages…",
			});
			messages = [
				...input.priorMessages,
				{ role: "user", content: input.effectiveText },
			];
			ctx.emit({
				type: "lifecycle_end",
				id: mergeLifecycleId,
				seq: ctx.nextSeq(),
				detail: "Session messages updated.",
			});
		}

		const attachedSkills = input.spec?.relevantSkills ?? [];
		if (attachedSkills.length > 0 && ctx.onStatusLine) {
			await ctx.onStatusLine(
				`Attaching skill instructions: ${attachedSkills.join(", ")}.`,
			);
		}

		messages = injectSkillBodiesIntoFirstSystemMessage(
			messages,
			attachedSkills,
			[...input.localSkills],
		);

		if (ctx.onStatusLine) {
			await ctx.onStatusLine("Session ready.");
		}

		return {
			...input,
			messages,
		};
	},
};
