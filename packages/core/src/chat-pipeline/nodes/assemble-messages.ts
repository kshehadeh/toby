import { randomUUID } from "node:crypto";
import type { TextPart, UserContent } from "ai";
import type { CoreMessage } from "../../ai/chat";
import { resolveChatAttachmentCapability } from "../../ai/model-capabilities";
import {
	injectMemoriesIntoFirstSystemMessage,
	injectProjectContextIntoFirstSystemMessage,
	injectSkillBodiesIntoFirstSystemMessage,
	prepareChatSessionMessages,
} from "../../prepare-messages";
import {
	chatAttachmentsToFileParts,
	formatAttachmentTranscriptSummary,
} from "../attachments";
import type { AssembledTurn, ExpandedTurn, PipelineNode } from "../pipeline";

function withAttachmentParts(
	text: string,
	attachments: ExpandedTurn["attachments"],
	canUseAttachments: boolean,
): UserContent {
	const fileParts = canUseAttachments
		? chatAttachmentsToFileParts(attachments)
		: [];
	if (fileParts.length === 0) {
		return text;
	}
	return [{ type: "text", text } satisfies TextPart, ...fileParts];
}

function attachFilesToLastUserMessage(
	messages: readonly CoreMessage[],
	attachments: ExpandedTurn["attachments"],
	canUseAttachments: boolean,
): CoreMessage[] {
	const fileParts = canUseAttachments
		? chatAttachmentsToFileParts(attachments)
		: [];
	if (fileParts.length === 0) {
		return [...messages];
	}
	const next = [...messages];
	for (let i = next.length - 1; i >= 0; i--) {
		const message = next[i];
		if (message?.role !== "user") {
			continue;
		}
		const textParts: TextPart[] =
			typeof message.content === "string"
				? [{ type: "text", text: message.content }]
				: Array.isArray(message.content)
					? message.content
							.map((part) => {
								if (
									part &&
									typeof part === "object" &&
									"type" in part &&
									part.type === "text" &&
									"text" in part &&
									typeof part.text === "string"
								) {
									return { type: "text" as const, text: part.text };
								}
								return null;
							})
							.filter((part): part is TextPart => part !== null)
					: [];
		next[i] = {
			role: "user",
			content: [...textParts, ...fileParts],
		};
		return next;
	}
	return next;
}

export const assembleMessagesNode: PipelineNode<ExpandedTurn, AssembledTurn> = {
	name: "assemble-messages",
	async run(input, ctx) {
		let messages: CoreMessage[];
		const attachmentCapability = resolveChatAttachmentCapability(ctx.persona);
		const modelAttachments = attachmentCapability.supported
			? (input.attachments ?? []).filter((attachment) =>
					attachmentCapability.acceptedMediaTypes.includes(
						attachment.mediaType,
					),
				)
			: [];
		// File-part metadata is not exposed consistently by model providers. Include
		// an exact filename list in text so project attachment tools can be called
		// even when a model can inspect the file content but not its filename.
		const messageText =
			input.effectiveText +
			formatAttachmentTranscriptSummary(input.attachments);

		if (input.isFirstTurn) {
			if (ctx.onStatusLine) {
				await ctx.onStatusLine("Fetching integration connection context…");
			}
			messages = attachFilesToLastUserMessage(
				await prepareChatSessionMessages(
					ctx.modules,
					ctx.persona,
					messageText,
					ctx.onStatusLine,
					ctx.project,
				),
				modelAttachments,
				true,
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
				{
					role: "user",
					content: withAttachmentParts(messageText, modelAttachments, true),
				},
			];
			ctx.emit({
				type: "lifecycle_end",
				id: mergeLifecycleId,
				seq: ctx.nextSeq(),
				detail: "Session messages updated.",
			});
		}

		// Only attach skills that pretreatment/routing selected.
		// Project skills are included in the routing catalog (turn-init) and
		// are selected the same way as global skills — no auto-attach.
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

		if (ctx.project) {
			if (ctx.onStatusLine) {
				await ctx.onStatusLine(`Loading project context: ${ctx.project.name}…`);
			}
			messages = injectProjectContextIntoFirstSystemMessage(
				messages,
				ctx.project,
			);
		}

		messages = injectMemoriesIntoFirstSystemMessage(messages);

		if (ctx.onStatusLine) {
			await ctx.onStatusLine("Session ready.");
		}

		return {
			...input,
			messages,
		};
	},
};
