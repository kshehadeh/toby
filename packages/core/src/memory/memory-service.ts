import * as store from "./memory-store";
import {
	classifySensitivity,
	detectExplicitStatement,
	shouldAutoSave,
	suggestVisibility,
} from "./policy";
import type {
	MemoryCandidate,
	MemoryContextBundle,
	MemoryExplanation,
	MemoryItem,
	MemoryProposal,
	MemorySensitivity,
	MemorySource,
	MemorySourceSystem,
	MemoryVisibility,
	RetrieveForTaskOptions,
} from "./types";

export function search(userId: string, query: string): MemoryItem[] {
	return store.searchItems(userId, query);
}

export function get(userId: string, memoryId: string): MemoryItem | null {
	return store.getItem(userId, memoryId);
}

export function propose(
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
): MemoryProposal {
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
		const item = saveFromProposal(userId, proposal, sourceRecord.id);
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

function saveFromProposal(
	userId: string,
	proposal: MemoryProposal,
	sourceId: string,
): MemoryItem {
	const c = proposal.candidate;
	const item = store.insertItem(
		userId,
		c.type,
		c.subject,
		c.value,
		c.confidence,
		proposal.sensitivity,
		proposal.suggestedVisibility,
		c.expiresAt,
	);
	store.linkItemSource(item.id, sourceId);
	store.updateProposalStatus(userId, proposal.id, "accepted");
	return item;
}

export function save(userId: string, proposalId: string): MemoryItem {
	const proposal = store.getProposal(userId, proposalId);
	if (!proposal) {
		throw new Error(`Proposal ${proposalId} not found for user ${userId}`);
	}
	if (proposal.status !== "pending") {
		throw new Error(
			`Proposal ${proposalId} is ${proposal.status}, not pending`,
		);
	}

	const item = saveFromProposal(userId, proposal, proposal.sourceId);
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
	store.updateProposalStatus(userId, proposalId, "rejected", reason);
	store.insertAuditEntry(userId, undefined, "rejected", {
		proposalId,
		rejectionReason: reason,
	});
}

export function update(
	userId: string,
	memoryId: string,
	patch: {
		value?: string;
		confidence?: number;
		sensitivity?: MemorySensitivity;
		visibility?: MemoryVisibility;
		subject?: string;
		expiresAt?: string | null;
	},
): MemoryItem {
	const existing = store.getItem(userId, memoryId);
	if (!existing) {
		throw new Error(`Memory ${memoryId} not found for user ${userId}`);
	}
	const updated = store.updateItem(userId, memoryId, patch);
	if (!updated) {
		throw new Error(`Failed to update memory ${memoryId}`);
	}
	store.insertAuditEntry(userId, memoryId, "updated", { patch });
	return updated;
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

function extractKeywords(text: string): string[] {
	const stopWords = new Set([
		"a",
		"an",
		"the",
		"is",
		"are",
		"was",
		"were",
		"be",
		"been",
		"being",
		"have",
		"has",
		"had",
		"do",
		"does",
		"did",
		"will",
		"would",
		"could",
		"should",
		"may",
		"might",
		"can",
		"shall",
		"to",
		"of",
		"in",
		"for",
		"on",
		"with",
		"at",
		"by",
		"from",
		"as",
		"into",
		"through",
		"during",
		"before",
		"after",
		"above",
		"below",
		"between",
		"out",
		"off",
		"over",
		"under",
		"again",
		"further",
		"then",
		"once",
		"and",
		"but",
		"or",
		"nor",
		"not",
		"so",
		"if",
		"this",
		"that",
		"these",
		"those",
		"i",
		"me",
		"my",
		"we",
		"our",
		"you",
		"your",
		"it",
		"its",
		"he",
		"she",
		"they",
		"them",
		"what",
		"which",
		"who",
		"when",
		"where",
		"how",
		"all",
		"each",
		"every",
		"both",
		"few",
		"more",
		"most",
		"other",
		"some",
		"such",
		"no",
		"only",
		"own",
		"same",
		"than",
		"too",
		"very",
		"just",
		"also",
		"about",
		"up",
	]);
	return text
		.toLowerCase()
		.replace(/[^\w\s]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 2 && !stopWords.has(w));
}

export function retrieveForTask(
	userId: string,
	taskDescription: string,
	options?: RetrieveForTaskOptions,
): MemoryContextBundle {
	const maxItems = options?.maxItems ?? 10;
	const visibilities = ["usable_by_ai"];
	if (options?.includeUnconfirmed) {
		visibilities.push("requires_confirmation");
	}

	const keywords = extractKeywords(taskDescription);
	const memories = store.getItemsForRetrieval(
		userId,
		visibilities,
		keywords,
		maxItems,
	);

	const omittedCount = countOmitted(userId, taskDescription);

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

function countOmitted(userId: string, _taskDescription: string): number {
	const db = store.getDb();
	const row = db
		.query(
			`SELECT COUNT(*) as count FROM memory_items
       WHERE user_id = $uid AND visibility NOT IN ('usable_by_ai')`,
		)
		.get({ $uid: userId }) as { count: number } | undefined;
	return Number(row?.count ?? 0);
}
