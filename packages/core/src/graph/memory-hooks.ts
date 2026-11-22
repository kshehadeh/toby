import { daemonLog } from "../logging/daemon-log";
import type { MemoryItem } from "../memory/types";
import { deleteObservation, findObservation } from "../observations/store";
import { entityNameKey } from "./keys";
import {
	deleteNode,
	deleteNodeByRef,
	edgesTouching,
	findNode,
	getNode,
	removeEdgesTouchingNode,
} from "./store";
import type { GraphNodeInput } from "./types";
import { writeGraph } from "./write";

const MEMORY_TEXT_MAX = 1000;

/** Remove the activity ledger copy as well as relationships derived from it. */
function removeMemoryObservation(memoryId: string): void {
	const observation = findObservation("memory", memoryId);
	if (!observation) return;
	const formerNeighbors = removeEdgesTouchingNode(observation.nodeId);
	deleteNode(observation.nodeId);
	deleteObservation(observation.id);
	for (const neighborId of formerNeighbors) {
		const neighbor = getNode(neighborId);
		if (
			neighbor &&
			["person", "org", "project", "topic"].includes(neighbor.type) &&
			edgesTouching([neighborId]).length === 0
		)
			deleteNode(neighborId);
	}
}

export function memoryNodeInput(item: MemoryItem): GraphNodeInput {
	const subject = item.subject?.trim();
	return {
		type: "memory",
		key: item.id,
		label: subject || item.value.trim().slice(0, 80),
		props: {
			memoryType: item.type,
			text: item.value.slice(0, MEMORY_TEXT_MAX),
			subject: subject ?? null,
			expiresAt: item.expiresAt ?? null,
		},
		sensitivity: item.sensitivity,
		visibility: item.visibility,
		ref: { table: "memory_items", id: item.id },
	};
}

/**
 * Mirror a saved or updated memory into the graph and queue enrichment when
 * its text changed. Graph failures are logged and never fail the memory write.
 */
export function syncMemoryNode(
	item: MemoryItem,
	opts: { readonly textChanged: boolean },
): void {
	try {
		const node = memoryNodeInput(item);
		const subject = item.subject?.trim();
		const usable = item.visibility === "usable_by_ai";
		const existing = findNode({ type: "memory", key: item.id });
		if (
			!usable ||
			opts.textChanged ||
			existing?.props.expiresAt !== (item.expiresAt ?? null)
		)
			removeMemoryObservation(item.id);
		if (existing) {
			const formerNeighbors = removeEdgesTouchingNode(
				existing.id,
				usable ? { origin: "deterministic", type: "about" } : {},
			);
			for (const neighborId of formerNeighbors) {
				const neighbor = getNode(neighborId);
				if (
					neighbor &&
					["person", "org", "project", "topic"].includes(neighbor.type) &&
					edgesTouching([neighborId]).length === 0
				)
					deleteNode(neighborId);
			}
		}
		writeGraph({
			nodes: [node],
			...(usable && subject
				? {
						edges: [
							{
								src: node,
								dst: {
									type: "person" as const,
									key: entityNameKey(subject),
									label: subject,
								},
								type: "about" as const,
							},
						],
					}
				: {}),
			enrich: opts.textChanged && usable ? ["embed", "extract"] : [],
		});
	} catch (error) {
		daemonLog("warn", "general", "graph_memory_sync_failed", {
			memoryId: item.id,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

export function removeMemoryNode(memoryId: string): void {
	try {
		removeMemoryObservation(memoryId);
		deleteNodeByRef({ type: "memory", key: memoryId });
	} catch (error) {
		daemonLog("warn", "general", "graph_memory_remove_failed", {
			memoryId,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}
