export type LibraryItemStatus = "pending" | "ready" | "failed";

export const LibraryItemStatusValues: readonly LibraryItemStatus[] = [
	"pending",
	"ready",
	"failed",
];

export type LibraryItemSource = "ui" | "chat" | "tool";

export const LibraryItemSourceValues: readonly LibraryItemSource[] = [
	"ui",
	"chat",
	"tool",
];

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
}

export interface LibraryOpenResult {
	readonly item: LibraryItem;
	readonly extractedText?: string;
	readonly bytes?: Uint8Array;
}
