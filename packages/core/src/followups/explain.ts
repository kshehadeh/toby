import { edgesTouching, getNode } from "../graph/store";
import { getObservationByNode } from "../observations/store";
import { findFollowupByTodoId } from "./store";

/** Source-backed explanation for the todo inspector and chat tool. */
export function explainTobyFollowup(todoId: string): {
	readonly loop: ReturnType<typeof findFollowupByTodoId>;
	readonly evidence: Array<{
		readonly id: string;
		readonly reason: string;
		readonly title: string;
		readonly occurredAt: string;
		readonly url?: string;
	}>;
} | null {
	const loop = findFollowupByTodoId(todoId);
	if (!loop) return null;
	const evidence = edgesTouching([loop.loopId], {
		edgeTypes: ["evidence_for"],
		fanout: 100,
	})
		.map((edge) => {
			const nodeId = edge.src === loop.loopId ? edge.dst : edge.src;
			const node = getNode(nodeId);
			const observation = getObservationByNode(nodeId);
			if (!node) return null;
			return {
				id: nodeId,
				reason: edge.reason ?? "Evidence related to this follow-up.",
				title: observation?.title ?? node.label,
				occurredAt: observation?.occurredAt ?? node.updatedAt,
				...(observation?.url ? { url: observation.url } : {}),
			};
		})
		.filter((item): item is NonNullable<typeof item> => item !== null);
	return { loop, evidence };
}
