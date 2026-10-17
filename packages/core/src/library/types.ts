export type LibraryItemStatus = "pending" | "ready" | "failed";

export const LibraryItemStatusValues: readonly LibraryItemStatus[] = [
	"pending",
	"ready",
	"failed",
];

export type LibraryItemSource = "ui" | "chat" | "tool" | "project";

export const LibraryItemSourceValues: readonly LibraryItemSource[] = [
	"ui",
	"chat",
	"tool",
	"project",
];

/** Where a library file was seen. One item can have many of these. */
export type LibraryReferenceKind = "manual" | "chat" | "project";

export const LibraryReferenceKindValues: readonly LibraryReferenceKind[] = [
	"manual",
	"chat",
	"project",
];

export interface LibraryReferenceInput {
	readonly kind: LibraryReferenceKind;
	/** Session title, project name, or "Library". */
	readonly label: string;
	/** Project-relative path, or the filename as attached in chat. */
	readonly detail?: string | null;
	readonly sessionId?: string | null;
	readonly projectId?: string | null;
}

export interface LibraryReference extends LibraryReferenceInput {
	readonly id: string;
	readonly itemId: string;
	readonly createdAt: string;
}

export interface LibraryItem {
	readonly id: string;
	readonly title: string;
	readonly originalFilename: string;
	readonly relativePath: string;
	readonly mimeType: string;
	readonly byteSize: number;
	readonly contentHash: string;
	readonly description: string;
	readonly status: LibraryItemStatus;
	readonly error?: string | null;
	readonly source: LibraryItemSource;
	readonly createdAt: string;
	readonly updatedAt: string;
	/** Embedding model id when a vector is stored for this item. */
	readonly embeddingModel?: string;
	/** Places this file was attached, saved, or added. */
	readonly references?: readonly LibraryReference[];
}

export interface LibraryOpenResult {
	readonly item: LibraryItem;
	readonly extractedText?: string;
	readonly bytes?: Uint8Array;
}
