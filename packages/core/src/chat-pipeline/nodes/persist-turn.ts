import { randomUUID } from "node:crypto";
import {
	appendMessageBatch,
	setSessionLastPretreatment,
} from "../../session-store";
import type {
	CommittedTurn,
	PipelineNode,
	RanTurn,
	TurnContext,
} from "../pipeline";

export const persistTurnNode: PipelineNode<RanTurn, CommittedTurn> = {
	name: "persist-turn",
	async run(input, ctx) {
		const messagesAfterTurn = [...input.messages, ...input.responseMessages];

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
