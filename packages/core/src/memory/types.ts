export type MemoryType =
	| "preference"
	| "relationship"
	| "project"
	| "life_event"
	| "fact"
	| "summary";

export type MemorySensitivity = "normal" | "sensitive" | "restricted";

export type MemoryVisibility =
	| "usable_by_ai"
	| "requires_confirmation"
	| "private";

export type MemorySourceSystem =
	| "gmail"
	| "calendar"
	| "drive"
	| "chat"
	| "manual"
	| "other";

export type MemoryProposalStatus = "pending" | "accepted" | "rejected";

export type MemoryAuditAction =
	| "proposed"
	| "saved"
	| "rejected"
	| "updated"
	| "forgotten"
	| "retrieved";

export interface MemoryItem {
	readonly id: string;
	readonly userId: string;
	readonly type: MemoryType;
	readonly subject?: string;
	readonly value: string;
	readonly confidence: number;
	readonly sensitivity: MemorySensitivity;
	readonly visibility: MemoryVisibility;
	readonly sourceIds: string[];
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly expiresAt?: string | null;
}

export interface MemorySource {
	readonly id: string;
	readonly userId: string;
	readonly system: MemorySourceSystem;
	readonly sourceId?: string;
	readonly sourceUrl?: string;
	readonly observedAt: string;
	readonly excerpt?: string;
	readonly metadata?: Record<string, unknown>;
}

export interface MemoryProposal {
	readonly id: string;
	readonly userId: string;
	readonly status: MemoryProposalStatus;
	readonly candidate: MemoryCandidate;
	readonly sourceId: string;
	readonly confidence: number;
	readonly sensitivity: MemorySensitivity;
	readonly suggestedVisibility: MemoryVisibility;
	readonly reason: string;
	readonly rejectionReason?: string;
	readonly createdAt: string;
	readonly resolvedAt?: string;
}

export type MemoryCandidate = Omit<
	MemoryItem,
	"id" | "createdAt" | "updatedAt" | "sourceIds"
>;

export interface MemoryContextBundle {
	readonly memories: MemoryItem[];
	readonly summary: string;
	readonly omitted: {
		readonly count: number;
		readonly reason: string;
	};
}

export interface MemoryAuditEntry {
	readonly id: string;
	readonly userId: string;
	readonly memoryId?: string;
	readonly action: MemoryAuditAction;
	readonly detail?: Record<string, unknown>;
	readonly createdAt: string;
}

export interface MemoryExplanation {
	readonly item: MemoryItem;
	readonly sources: MemorySource[];
	readonly auditTrail: MemoryAuditEntry[];
}

export interface RetrieveForTaskOptions {
	readonly includeUnconfirmed?: boolean;
	readonly maxItems?: number;
}
