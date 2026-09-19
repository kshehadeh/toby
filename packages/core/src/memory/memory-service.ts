import {
	embedMemoryText,
	findNearDuplicate,
	resolveMemoryEmbedder,
	semanticMemoryHits,
	storeMemoryEmbedding,
} from "./embeddings";
import { extractKeywords, rankMemories, rankMemoriesHybrid } from "./keywords";
import * as store from "./memory-store";
import {
	classifySensitivity,
	detectExplicitStatement,
	shouldAutoSave,
	suggestVisibility,
} from "./policy";
import {
	formatMemoryEmbedText,
	isMoreSpecificMemoryValue,
	memoryContentHash,
} from "./text";
import type {
	MemoryCandidate,
	MemoryContextBundle,
	MemoryExplanation,
	MemoryItem,
	MemoryProposal,
	MemorySensitivity,
	MemorySourceSystem,
	MemoryVisibility,
	RetrieveForTaskOptions,
} from "./types";

export async function search(
	userId: string,
	query: string,
): Promise<MemoryItem[]> {
	const trimmed = query.trim();
	if (!trimmed) return [];
	const keywords = extractKeywords(trimmed);
	const keywordItems =
		keywords.length === 0
			? store.searchItems(userId, trimmed)
			: store.searchItemsByKeywords(userId, keywords);
	const semanticScores = await semanticMemoryHits({ userId, query: trimmed });
	if (semanticScores.size === 0) {
		return rankMemories(keywordItems, trimmed, keywords);
	}
	const byId = new Map(keywordItems.map((item) => [item.id, item]));
	for (const id of semanticScores.keys()) {
		if (byId.has(id)) continue;
		const item = store.getItem(userId, id);
		if (item) byId.set(id, item);
	}
	return rankMemoriesHybrid(
		[...byId.values()],
		trimmed,
		keywords,
		semanticScores,
	);
}

export function get(userId: string, memoryId: string): MemoryItem | null {
	return store.getItem(userId, memoryId);
}

export function listMemoryItems(
	userId: string,
	opts?: { query?: string; limit?: number; offset?: number },
): MemoryItem[] {
	return store.listItems(userId, opts);
}

export function countMemoryItems(
	userId: string,
	opts?: { query?: string },
): number {
	return store.countItems(userId, opts);
}

/** Memories allowed in the system prompt: `usable_by_ai` and not expired. */
export function listUsableForPrompt(
	userId: string,
	opts?: { limit?: number },
): MemoryItem[] {
	return store.listUsableItems(userId, opts);
}

export interface ManualMemoryInput {
	readonly type?: MemoryItem["type"];
	readonly subject?: string;
	readonly value: string;
	readonly confidence?: number;
	readonly sensitivity?: MemorySensitivity;
	readonly visibility?: MemoryVisibility;
	readonly expiresAt?: string | null;
}

/** Create a memory directly from manual user input (no proposal flow). */
export async function createManual(
	userId: string,
	input: ManualMemoryInput,
): Promise<MemoryItem> {
	const value = input.value.trim();
	if (!value) {
		throw new Error("Memory value is required");
	}
	const type = input.type ?? "fact";
	const confidence = input.confidence ?? 1;
	const sensitivity = input.sensitivity ?? "normal";
	const visibility = input.visibility ?? "usable_by_ai";

	const source = store.insertSource(
		userId,
		"manual",
		undefined,
		undefined,
		new Date().toISOString(),
		undefined,
		{ manual: true },
	);

	const { item, merged } = await persistNewOrMerge(
		userId,
		{
			type,
			subject: input.subject?.trim() || undefined,
			value,
			confidence,
			sensitivity,
			visibility,
			expiresAt: input.expiresAt ?? null,
		},
		source.id,
	);
	if (!merged) {
		store.insertAuditEntry(userId, item.id, "saved", {
			reason: "Manual creation",
			autoSaved: false,
			manual: true,
		});
	}
	return item;
}

export async function propose(
	userId: string,
	candidate: MemoryCandidate,
	source: {
		system: MemorySourceSystem;
		sourceId?: string;
		sourceUrl?: string;
		observedAt?: string;
		excerpt?: string;
		metadata?: Record<string, unknown>;
	},
	reason: string,
): Promise<MemoryProposal> {
	const sourceRecord = store.insertSource(
		userId,
		source.system,
		source.sourceId,
		source.sourceUrl,
		source.observedAt ?? new Date().toISOString(),
		source.excerpt,
		source.metadata,
	);

	const sensitivity = classifySensitivity(candidate);
	const isExplicit = detectExplicitStatement(candidate.value);
	const suggestedVisibility = suggestVisibility(
		sensitivity,
		candidate.type,
		isExplicit,
	);

	const proposal = store.insertProposal(
		userId,
		JSON.stringify(candidate),
		sourceRecord.id,
		candidate.confidence,
		sensitivity,
		suggestedVisibility,
		reason,
	);

	if (shouldAutoSave(proposal)) {
		const item = await saveFromProposal(userId, proposal, sourceRecord.id);
		store.insertAuditEntry(userId, item.id, "saved", {
			reason,
			autoSaved: true,
			proposalId: proposal.id,
		});
		return {
			...proposal,
			status: "accepted",
			resolvedAt: new Date().toISOString(),
		};
	}

	store.insertAuditEntry(userId, undefined, "proposed", {
		reason,
		proposalId: proposal.id,
		sensitivity,
		suggestedVisibility,
	});
	return proposal;
}

async function saveFromProposal(
	userId: string,
	proposal: MemoryProposal,
	sourceId: string,
): Promise<MemoryItem> {
	const c = proposal.candidate;
	const { item } = await persistNewOrMerge(
		userId,
		{
			type: c.type,
			subject: c.subject,
			value: c.value,
			confidence: c.confidence,
			sensitivity: proposal.sensitivity,
			visibility: proposal.suggestedVisibility,
			expiresAt: c.expiresAt,
		},
		sourceId,
	);
	store.updateProposalStatus(userId, proposal.id, "accepted");
	return item;
}

export async function save(
	userId: string,
	proposalId: string,
): Promise<MemoryItem> {
	const proposal = store.getProposal(userId, proposalId);
	if (!proposal) {
		throw new Error(`Proposal ${proposalId} not found for user ${userId}`);
	}
	if (proposal.status !== "pending") {
		throw new Error(
			`Proposal ${proposalId} is ${proposal.status}, not pending`,
		);
	}

	const item = await saveFromProposal(userId, proposal, proposal.sourceId);
	store.insertAuditEntry(userId, item.id, "saved", {
		proposalId,
		autoSaved: false,
	});
	return item;
}

export function reject(
	userId: string,
	proposalId: string,
	reason?: string,
): void {
	const proposal = store.getProposal(userId, proposalId);
	if (!proposal) {
		throw new Error(`Proposal ${proposalId} not found for user ${userId}`);
	}
	if (proposal.status !== "pending") {
		throw new Error(
			`Proposal ${proposalId} is ${proposal.status}, not pending`,
		);
	}
	store.updateProposalStatus(userId, proposal.id, "rejected", reason);
	store.insertAuditEntry(userId, undefined, "rejected", {
		proposalId,
		rejectionReason: reason,
	});
}

export async function update(
	userId: string,
	memoryId: string,
	patch: {
		value?: string;
		confidence?: number;
		sensitivity?: MemorySensitivity;
		visibility?: MemoryVisibility;
		subject?: string;
		type?: MemoryItem["type"];
		expiresAt?: string | null;
	},
): Promise<MemoryItem> {
	const existing = store.getItem(userId, memoryId);
	if (!existing) {
		throw new Error(`Memory ${memoryId} not found for user ${userId}`);
	}
	const updated = store.updateItem(userId, memoryId, patch);
	if (!updated) {
		throw new Error(`Failed to update memory ${memoryId}`);
	}
	store.insertAuditEntry(userId, memoryId, "updated", { patch });
	if (patch.value !== undefined || patch.subject !== undefined) {
		const embedder = resolveMemoryEmbedder();
		if (embedder) {
			await storeMemoryEmbedding(updated, embedder);
		}
	}
	return store.getItem(userId, memoryId) ?? updated;
}

export function forget(userId: string, memoryId: string): void {
	const existing = store.getItem(userId, memoryId);
	if (!existing) {
		throw new Error(`Memory ${memoryId} not found for user ${userId}`);
	}
	store.deleteItem(userId, memoryId);
	store.insertAuditEntry(userId, memoryId, "forgotten");
}

export function explain(userId: string, memoryId: string): MemoryExplanation {
	const item = store.getItem(userId, memoryId);
	if (!item) {
		throw new Error(`Memory ${memoryId} not found for user ${userId}`);
	}
	const sources = store.getSourcesForItem(memoryId);
	const auditTrail = store.getAuditEntriesForMemory(memoryId);
	return { item, sources, auditTrail };
}

export async function retrieveForTask(
	userId: string,
	taskDescription: string,
	options?: RetrieveForTaskOptions,
): Promise<MemoryContextBundle> {
	const maxItems = options?.maxItems ?? 10;
	const visibilities: MemoryVisibility[] = ["usable_by_ai"];
	if (options?.includeUnconfirmed) {
		visibilities.push("requires_confirmation");
	}

	const keywords = extractKeywords(taskDescription);
	const fetchLimit = Math.max(maxItems * 5, 25);
	const keywordCandidates = store.getItemsForRetrieval(
		userId,
		visibilities,
		keywords,
		fetchLimit,
	);
	const semanticScores = await semanticMemoryHits({
		userId,
		query: taskDescription,
		visibilities,
		topK: fetchLimit,
	});
	const byId = new Map(keywordCandidates.map((item) => [item.id, item]));
	if (semanticScores.size > 0) {
		const extra = store.getItemsByIds(userId, [...semanticScores.keys()]);
		for (const item of extra) {
			if (visibilities.includes(item.visibility)) {
				byId.set(item.id, item);
			}
		}
	}
	const ranked =
		semanticScores.size > 0
			? rankMemoriesHybrid(
					[...byId.values()],
					taskDescription,
					keywords,
					semanticScores,
				)
			: rankMemories(keywordCandidates, taskDescription, keywords);
	const memories = ranked.slice(0, maxItems);

	const omittedCount = countOmitted(userId);

	const summary =
		memories.length === 0
			? "No relevant memories found."
			: `${memories.length} relevant memory(ies): ${memories.map((m) => `(${m.type}) ${m.subject ?? m.value.slice(0, 60)}`).join("; ")}`;

	store.insertAuditEntry(userId, undefined, "retrieved", {
		taskDescription,
		returnedCount: memories.length,
		omittedCount,
	});

	return {
		memories,
		summary,
		omitted: {
			count: omittedCount,
			reason:
				"Private or requires-confirmation memories excluded from normal retrieval",
		},
	};
}

type PersistCandidate = {
	readonly type: MemoryItem["type"];
	readonly subject?: string;
	readonly value: string;
	readonly confidence: number;
	readonly sensitivity: MemorySensitivity;
	readonly visibility: MemoryVisibility;
	readonly expiresAt?: string | null;
};

async function persistNewOrMerge(
	userId: string,
	candidate: PersistCandidate,
	sourceId: string,
): Promise<{ item: MemoryItem; merged: boolean }> {
	const hash = memoryContentHash(candidate.value, candidate.subject);
	const exact = store.findItemByContentHash(userId, hash);
	if (exact) {
		return {
			item: await mergeIntoExisting(userId, exact, candidate, sourceId, {
				score: 1,
				reason: "exact",
				updateValue: false,
			}),
			merged: true,
		};
	}

	const embedder = resolveMemoryEmbedder();
	let queryVector: number[] | undefined;
	if (embedder) {
		queryVector =
			(await embedMemoryText(embedder, formatMemoryEmbedText(candidate))) ??
			undefined;
	}

	const near = await findNearDuplicate({
		userId,
		type: candidate.type,
		value: candidate.value,
		subject: candidate.subject,
		queryVector,
		embedder,
	});
	if (near) {
		const updateValue =
			near.reason === "near-dup" &&
			isMoreSpecificMemoryValue(candidate.value, near.item.value);
		return {
			item: await mergeIntoExisting(userId, near.item, candidate, sourceId, {
				score: near.score,
				reason: near.reason,
				updateValue,
				queryVector: updateValue ? queryVector : undefined,
				embedder,
			}),
			merged: true,
		};
	}

	const item = store.insertItem(
		userId,
		candidate.type,
		candidate.subject,
		candidate.value,
		candidate.confidence,
		candidate.sensitivity,
		candidate.visibility,
		candidate.expiresAt,
	);
	store.linkItemSource(item.id, sourceId);
	if (embedder) {
		await storeMemoryEmbedding(item, embedder, queryVector);
	}
	return { item: store.getItem(userId, item.id) ?? item, merged: false };
}

async function mergeIntoExisting(
	userId: string,
	existing: MemoryItem,
	candidate: PersistCandidate,
	sourceId: string,
	opts: {
		readonly score: number;
		readonly reason: "exact" | "near-exact" | "near-dup";
		readonly updateValue: boolean;
		readonly queryVector?: readonly number[];
		readonly embedder?: ReturnType<typeof resolveMemoryEmbedder>;
	},
): Promise<MemoryItem> {
	store.linkItemSource(existing.id, sourceId);
	const patch: {
		value?: string;
		confidence?: number;
	} = {};
	if (opts.updateValue) {
		patch.value = candidate.value;
	}
	const nextConfidence = Math.max(existing.confidence, candidate.confidence);
	if (nextConfidence !== existing.confidence) {
		patch.confidence = nextConfidence;
	}
	const updated =
		Object.keys(patch).length > 0
			? (store.updateItem(userId, existing.id, patch) ?? existing)
			: (store.updateItem(userId, existing.id, {
					confidence: existing.confidence,
				}) ?? existing);
	store.insertAuditEntry(userId, existing.id, "merged", {
		reason: opts.reason,
		score: opts.score,
		sourceId,
		updatedValue: opts.updateValue,
	});
	if (opts.updateValue) {
		const embedder = opts.embedder ?? resolveMemoryEmbedder();
		if (embedder) {
			await storeMemoryEmbedding(updated, embedder, opts.queryVector);
		}
	}
	return store.getItem(userId, existing.id) ?? updated;
}

function countOmitted(userId: string): number {
	const db = store.getDb();
	const row = db
		.query(
			`SELECT COUNT(*) as count FROM memory_items
       WHERE user_id = $uid AND visibility NOT IN ('usable_by_ai')`,
		)
		.get({ $uid: userId }) as { count: number } | undefined;
	return Number(row?.count ?? 0);
}
