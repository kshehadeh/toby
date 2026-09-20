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
	if (error instanceof LibraryError) return error.status;
	return 500;
}

export async function handleLibraryList(url: URL): Promise<Response> {
	const query = url.searchParams.get("q") ?? undefined;
	const limit = parseIntParam(url.searchParams.get("limit"), 50, 500);
	const offset = Math.max(
		0,
		Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0,
	);
	if (query?.trim()) {
		const all = await searchLibrary(query);
		const sliced = all.slice(offset, offset + limit);
		return jsonResponse({
			items: sliced,
			limit,
			offset,
			total: all.length,
			hasMore: offset + sliced.length < all.length,
		});
	}
	const items = listLibraryItems({ limit, offset });
	const total = countLibraryItems();
	return jsonResponse({
		items,
		limit,
		offset,
		total,
		hasMore: offset + items.length < total,
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
		const message = error instanceof Error ? error.message : String(error);
		return errorResponse(message, statusForError(error));
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
		const message = error instanceof Error ? error.message : String(error);
		return errorResponse(message, statusForError(error));
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
