import { randomUUID } from "node:crypto";
import type { CoreMessage } from "../../ai/chat";
import {
	injectProjectContextIntoFirstSystemMessage,
	injectSkillBodiesIntoFirstSystemMessage,
	prepareChatSessionMessages,
} from "../../prepare-messages";
import { loadProjectSkills } from "../../projects/index";
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
				ctx.project,
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

		// Auto-attach project-local skills as if they were built-in.
		const projectSkillNames = ctx.project
			? loadProjectSkills(ctx.project).map((s) => s.name)
			: [];
		const allAttachedSkills = [
			...new Set([...projectSkillNames, ...attachedSkills]),
		];

		if (allAttachedSkills.length > 0 && ctx.onStatusLine) {
			await ctx.onStatusLine(
				`Attaching skill instructions: ${allAttachedSkills.join(", ")}.`,
			);
		}

		messages = injectSkillBodiesIntoFirstSystemMessage(
			messages,
			allAttachedSkills,
			[...input.localSkills],
		);

		if (ctx.project) {
			if (ctx.onStatusLine) {
				await ctx.onStatusLine(`Loading project context: ${ctx.project.name}…`);
			}
			messages = injectProjectContextIntoFirstSystemMessage(
				messages,
				ctx.project,
			);
		}

		if (ctx.onStatusLine) {
			await ctx.onStatusLine("Session ready.");
		}

		return {
			...input,
			messages,
		};
	},
};
