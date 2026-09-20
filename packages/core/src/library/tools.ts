import { type Tool, tool } from "ai";
import { z } from "zod";
import type { ValidatedChatAttachment } from "../chat-pipeline/attachments";
import {
	addLibraryBytes,
	addLibraryText,
	countLibraryItems,
	listLibraryItems,
	openLibraryItem,
	removeLibraryItem,
	searchLibrary,
	updateLibraryItem,
} from "./library-service";
import { isLibraryImageMediaType } from "./media";
import type { LibraryItem } from "./types";

type LibraryToolsContext = {
	readonly dryRun: boolean;
	readonly appliedActions: string[];
	readonly attachments?: readonly ValidatedChatAttachment[];
};

function summarizeItem(item: LibraryItem) {
	return {
		id: item.id,
		title: item.title,
		filename: item.originalFilename,
		mimeType: item.mimeType,
		byteSize: item.byteSize,
		description: item.description,
		status: item.status,
		error: item.error ?? null,
	};
}

const LIBRARY_LIST_LIMIT = 50;

function isLibraryCatalogListQuery(query: string | undefined): boolean {
	const q = query?.trim().toLowerCase() ?? "";
	if (!q) return true;
	if (
		/^(list|show|display)\b/.test(q) &&
		/\b(all|everything|entire|items?|files?|contents?|library|catalog)\b/.test(
			q,
		)
	) {
		return true;
	}
	return /^(everything|all|all items|all files|\*)$/.test(q);
}

function listCatalog() {
	const items = listLibraryItems({ limit: LIBRARY_LIST_LIMIT, offset: 0 });
	const total = countLibraryItems();
	return {
		ok: true,
		listed: true,
		count: items.length,
		total,
		items: items.map(summarizeItem),
		hint:
			total === 0
				? "The library is empty. Use add_to_library to save a file."
				: total > items.length
					? `Showing the ${items.length} most recently updated of ${total} items (documents and images). Pass a more specific query to search, or an id to open one.`
					: "Complete catalog (documents and images). Pass id to open an item.",
	};
}

export function createLibraryTools(
	ctx: LibraryToolsContext,
): Record<string, Tool> {
	return {
		add_to_library: tool({
			description:
				"Add a file to the user's Library. Copies the original bytes, then summarizes and indexes them. Use when the user asks to keep, file, or remember a document or image in their library. Provide either `filename` of a current-turn attachment or UTF-8 `content` plus `filename`.",
			inputSchema: z.object({
				filename: z
					.string()
					.min(1)
					.describe(
						"Attachment filename on this turn, or the name to store when passing content",
					),
				content: z
					.string()
					.optional()
					.describe("UTF-8 text to store as a new library document"),
			}),
			execute: async ({ filename, content }) => {
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: `Would add "${filename}" to the library.`,
					};
				}
				try {
					const result = content
						? await addLibraryText({
								filename,
								content,
								source: "chat",
								waitForIndex: true,
							})
						: await addFromAttachment(ctx, filename);
					ctx.appliedActions.push(
						result.duplicate
							? `library: already had ${result.item.id}`
							: `library: added ${result.item.id}`,
					);
					return {
						ok: true,
						duplicate: result.duplicate,
						item: summarizeItem(result.item),
					};
				} catch (error) {
					return {
						ok: false,
						error: error instanceof Error ? error.message : String(error),
					};
				}
			},
		}),

		find_in_library: tool({
			description:
				"List, search, or open items in the user's Library of saved files (documents and images). Omit query to list the catalog. Use a search query for keywords/meaning. Pass `id` to load one item (extracted text for documents, original image bytes for pictures). Use this when the user asks what is in the library, to list everything, or to find a saved file.",
			inputSchema: z.object({
				query: z
					.string()
					.optional()
					.describe(
						"Natural-language search phrase. Omit (or use list/all/everything) to return the full catalog including images",
					),
				id: z
					.string()
					.optional()
					.describe("Library item id to open and load into this turn"),
			}),
			execute: async ({ query, id }) => {
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: id
							? `Would open library item ${id}.`
							: isLibraryCatalogListQuery(query)
								? "Would list library items."
								: `Would search the library for: ${query}`,
					};
				}
				if (id?.trim()) {
					try {
						const opened = openLibraryItem(id.trim());
						if (isLibraryImageMediaType(opened.item.mimeType) && opened.bytes) {
							return {
								ok: true,
								item: summarizeItem(opened.item),
								kind: "image" as const,
							};
						}
						return {
							ok: true,
							item: summarizeItem(opened.item),
							kind: "document" as const,
							extractedText: opened.extractedText ?? "",
						};
					} catch (error) {
						return {
							ok: false,
							error: error instanceof Error ? error.message : String(error),
						};
					}
				}
				if (isLibraryCatalogListQuery(query)) {
					return listCatalog();
				}
				const results = await searchLibrary(query?.trim() ?? "");
				if (results.length === 0) {
					return {
						ok: true,
						count: 0,
						items: [],
						hint: "No library items matched. Omit query to list the full catalog, or try fewer keywords.",
					};
				}
				return {
					ok: true,
					count: results.length,
					items: results.slice(0, 15).map(summarizeItem),
				};
			},
			toModelOutput: ({ output }) => {
				const result = output as {
					ok?: boolean;
					kind?: string;
					item?: {
						id: string;
						mimeType: string;
						description: string;
						title: string;
					};
				};
				if (result?.ok && result.kind === "image" && result.item) {
					try {
						const opened = openLibraryItem(result.item.id);
						if (opened.bytes) {
							return {
								type: "content",
								value: [
									{
										type: "text",
										text: JSON.stringify({
											ok: true,
											item: summarizeItem(opened.item),
											kind: "image",
										}),
									},
									{
										type: "media",
										mediaType: opened.item.mimeType,
										data: Buffer.from(opened.bytes).toString("base64"),
									},
								],
							};
						}
					} catch {
						// Fall through to default JSON output.
					}
				}
				return {
					type: "json",
					value: output as Record<string, unknown>,
				};
			},
		}),

		update_in_library: tool({
			description:
				"Update a library item's title or description, or replace its file with a current-turn attachment. Re-indexes when the file changes. Only call when the user asks to update a saved library item.",
			inputSchema: z.object({
				id: z.string().min(1).describe("Library item id"),
				title: z.string().optional().describe("Replacement title"),
				description: z.string().optional().describe("Replacement description"),
				filename: z
					.string()
					.optional()
					.describe(
						"Current-turn attachment filename to replace the stored file",
					),
			}),
			execute: async ({ id, title, description, filename }) => {
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: `Would update library item ${id}.`,
					};
				}
				try {
					const attachment = filename
						? ctx.attachments?.find(
								(candidate) => candidate.filename === filename,
							)
						: undefined;
					if (filename && !attachment) {
						return {
							ok: false,
							error: `No current-turn attachment named "${filename}".`,
						};
					}
					const item = await updateLibraryItem(id, {
						title,
						description,
						filename: attachment?.filename,
						bytes: attachment
							? Buffer.from(attachment.dataBase64, "base64")
							: undefined,
						mediaType: attachment?.mediaType,
						waitForIndex: true,
					});
					ctx.appliedActions.push(`library: updated ${item.id}`);
					return { ok: true, item: summarizeItem(item) };
				} catch (error) {
					return {
						ok: false,
						error: error instanceof Error ? error.message : String(error),
					};
				}
			},
		}),

		remove_from_library: tool({
			description:
				"Permanently delete a library item and its stored file. Only call when the user explicitly asks to remove it from the library.",
			inputSchema: z.object({
				id: z.string().min(1).describe("Library item id to delete"),
			}),
			execute: async ({ id }) => {
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: `Would remove library item ${id}.`,
					};
				}
				const removed = removeLibraryItem(id);
				if (!removed) {
					return { ok: false, error: "Library item not found." };
				}
				ctx.appliedActions.push(`library: removed ${id}`);
				return { ok: true, id };
			},
		}),
	};
}

async function addFromAttachment(ctx: LibraryToolsContext, filename: string) {
	const attachment = ctx.attachments?.find(
		(candidate) => candidate.filename === filename,
	);
	if (!attachment) {
		throw new Error(`No current-turn attachment named "${filename}".`);
	}
	return addLibraryBytes({
		filename: attachment.filename,
		bytes: Buffer.from(attachment.dataBase64, "base64"),
		mediaType: attachment.mediaType,
		source: "chat",
		waitForIndex: true,
	});
}
