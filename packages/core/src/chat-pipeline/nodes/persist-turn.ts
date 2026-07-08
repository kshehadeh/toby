import { randomUUID } from "node:crypto";
import {
	appendMessageBatch,
	setSessionLastPretreatment,
} from "../../session-store";
import { formatAttachmentTranscriptSummary } from "../attachments";
import type {
	CommittedTurn,
	PipelineNode,
	RanTurn,
	TurnContext,
} from "../pipeline";

function stripCurrentTurnAttachments(input: RanTurn) {
	if (!input.attachments || input.attachments.length === 0) {
		return [...input.messages, ...input.responseMessages];
	}
	const summary = formatAttachmentTranscriptSummary(input.attachments).trim();
	const targetIndex = [...input.messages]
		.reverse()
		.findIndex(
			(message) =>
				message.role === "user" &&
				Array.isArray(message.content) &&
				message.content.some(
					(part) =>
						typeof part === "object" &&
						part !== null &&
						"type" in part &&
						part.type === "file",
				),
		);
	if (targetIndex === -1) {
		return [...input.messages, ...input.responseMessages];
	}
	const currentUserIndex = input.messages.length - 1 - targetIndex;
	const messages = input.messages.map((message, index) => {
		if (index !== currentUserIndex || message.role !== "user") {
			return message;
		}
		const content = message.content;
		if (!Array.isArray(content)) {
			return message;
		}
		const text = content
			.filter(
				(part): part is { type: "text"; text: string } =>
					typeof part === "object" &&
					part !== null &&
					"type" in part &&
					part.type === "text" &&
					"text" in part &&
					typeof part.text === "string",
			)
			.map((part) => part.text)
			.join("\n")
			.trim();
		return {
			role: "user" as const,
			content: text ? `${text}\n\n${summary}` : summary,
		};
	});
	return [...messages, ...input.responseMessages];
}

export const persistTurnNode: PipelineNode<RanTurn, CommittedTurn> = {
	name: "persist-turn",
	async run(input, ctx) {
		const messagesAfterTurn = stripCurrentTurnAttachments(input);

		if (ctx.emitPersistLifecycle) {
			const persistId = randomUUID();
			ctx.emit({
				type: "lifecycle_start",
				id: persistId,
				seq: ctx.nextSeq(),
				header: "Saving session…",
			});
			ctx.emit({
				type: "lifecycle_end",
				id: persistId,
				seq: ctx.nextSeq(),
				detail: "Session data queued to save.",
			});
		}

		if (ctx.persist) {
			const { sessionId, startIdx } = ctx.persist;
			appendMessageBatch(
				sessionId,
				startIdx,
				messagesAfterTurn.slice(startIdx),
			);
			if (input.spec) {
				setSessionLastPretreatment(sessionId, {
					rawUserText: input.rawUserText,
					spec: input.spec,
				});
			}
		}

		return {
			...input,
			messagesAfterTurn,
		};
	},
};
