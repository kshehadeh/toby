import { GatewayFundsError } from "../../ai/gateway-funds";
import { scheduleLibraryEmbeddingBackfill } from "../../library/embeddings";
import {
	isLibraryCatalogSyncing,
	scheduleLibraryCatalogSync,
} from "../../library/library-catalog";
import {
	LibraryError,
	addLibraryBytes,
	countLibraryItems,
	getLibraryItem,
	listLibraryItems,
	removeLibraryItem,
	searchLibrary,
	updateLibraryItem,
} from "../../library/library-service";
import {
	type LibraryReferenceKind,
	LibraryReferenceKindValues,
} from "../../library/types";
import {
	errorResponse,
	jsonResponse,
	parseIntParam,
	readJsonBody,
} from "../http-utils";

function decodeBase64(value: string): Buffer | null {
	try {
		const buf = Buffer.from(value, "base64");
		return buf.byteLength > 0 ? buf : null;
	} catch {
		return null;
	}
}

function statusForError(error: unknown): number {
	if (error instanceof GatewayFundsError) return 402;
	if (error instanceof LibraryError) return error.status;
	return 500;
}

function libraryErrorResponse(error: unknown): Response {
	if (error instanceof GatewayFundsError) {
		return jsonResponse(error.toBody(), 402);
	}
	const message = error instanceof Error ? error.message : String(error);
	return errorResponse(message, statusForError(error));
}

function parseOrigin(
	value: string | null,
): LibraryReferenceKind | undefined | null {
	const origin = value?.trim();
	if (!origin || origin === "all") return undefined;
	if ((LibraryReferenceKindValues as readonly string[]).includes(origin)) {
		return origin as LibraryReferenceKind;
	}
	return null;
}

export async function handleLibraryList(url: URL): Promise<Response> {
	const query = url.searchParams.get("q") ?? undefined;
	const origin = parseOrigin(url.searchParams.get("origin"));
	if (origin === null) {
		return errorResponse(
			"Query 'origin' must be all, manual, chat, or project.",
			400,
		);
	}
	const limit = parseIntParam(url.searchParams.get("limit"), 50, 500);
	const offset = Math.max(
		0,
		Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0,
	);
	scheduleLibraryCatalogSync({
		force: url.searchParams.get("refresh") === "1",
	});
	scheduleLibraryEmbeddingBackfill();
	const catalogSyncing = isLibraryCatalogSyncing();
	if (query?.trim()) {
		const all = await searchLibrary(query, origin);
		const sliced = all.slice(offset, offset + limit);
		return jsonResponse({
			items: sliced,
			limit,
			offset,
			total: all.length,
			hasMore: offset + sliced.length < all.length,
			catalogSyncing,
		});
	}
	const items = listLibraryItems({ limit, offset, origin });
	const total = countLibraryItems(origin);
	return jsonResponse({
		items,
		limit,
		offset,
		total,
		hasMore: offset + items.length < total,
		catalogSyncing,
	});
}

export function handleLibraryDetail(id: string): Response {
	const item = getLibraryItem(id);
	if (!item) {
		return errorResponse("Library item not found", 404);
	}
	return jsonResponse({ item });
}

export async function handleLibraryCreate(req: Request): Promise<Response> {
	const body = await readJsonBody<Record<string, unknown>>(req);
	if (!body) {
		return errorResponse("Invalid JSON body", 400);
	}
	const filename =
		typeof body.filename === "string" ? body.filename.trim() : "";
	if (!filename) {
		return errorResponse("Body must include a non-empty 'filename' field", 400);
	}
	const mediaType =
		typeof body.mediaType === "string" ? body.mediaType : undefined;
	const dataBase64 =
		typeof body.dataBase64 === "string" ? body.dataBase64.trim() : "";
	if (!dataBase64) {
		return errorResponse(
			"Body must include a non-empty 'dataBase64' field",
			400,
		);
	}
	const bytes = decodeBase64(dataBase64);
	if (!bytes) {
		return errorResponse("dataBase64 is not valid base64", 400);
	}
	try {
		const result = await addLibraryBytes({
			filename,
			bytes,
			mediaType,
			source: "ui",
			waitForIndex: false,
		});
		return jsonResponse(
			{ item: result.item, duplicate: result.duplicate },
			result.duplicate ? 200 : 201,
		);
	} catch (error) {
		return libraryErrorResponse(error);
	}
}

export async function handleLibraryPatch(
	id: string,
	req: Request,
): Promise<Response> {
	const body = await readJsonBody<Record<string, unknown>>(req);
	if (!body) {
		return errorResponse("Invalid JSON body", 400);
	}
	const title = typeof body.title === "string" ? body.title : undefined;
	const description =
		typeof body.description === "string" ? body.description : undefined;
	const filename =
		typeof body.filename === "string" ? body.filename.trim() : undefined;
	const mediaType =
		typeof body.mediaType === "string" ? body.mediaType : undefined;
	const dataBase64 =
		typeof body.dataBase64 === "string" ? body.dataBase64.trim() : undefined;
	const bytes = dataBase64 ? decodeBase64(dataBase64) : undefined;
	if (dataBase64 && !bytes) {
		return errorResponse("dataBase64 is not valid base64", 400);
	}
	if (title === undefined && description === undefined && bytes === undefined) {
		return errorResponse(
			"Body must include at least one of title, description, or dataBase64",
			400,
		);
	}
	try {
		const item = await updateLibraryItem(id, {
			title,
			description,
			filename,
			mediaType,
			bytes: bytes ?? undefined,
			waitForIndex: Boolean(bytes),
		});
		return jsonResponse({ item });
	} catch (error) {
		return libraryErrorResponse(error);
	}
}

export function handleLibraryDelete(id: string): Response {
	const existing = getLibraryItem(id);
	if (!existing) {
		return errorResponse("Library item not found", 404);
	}
	try {
		removeLibraryItem(id);
		return jsonResponse({ ok: true, id });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return errorResponse(message, 500);
	}
}
