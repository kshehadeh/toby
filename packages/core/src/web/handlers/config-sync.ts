import {
	type SyncBackend,
	type SyncEnableMode,
	disableSync,
	enableSync,
	getSyncStatus,
	isSyncBackend,
	listSyncHistory,
	pullSnapshot,
	pushSnapshot,
	restoreSyncHistory,
} from "../../config/sync";
import { errorResponse, jsonResponse, readJsonBody } from "../http-utils";

export async function handleConfigSyncStatus(): Promise<Response> {
	try {
		const status = await getSyncStatus();
		return jsonResponse(status);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return errorResponse(message, 400);
	}
}

export async function handleConfigSyncEnable(req: Request): Promise<Response> {
	const body = await readJsonBody<{
		password?: string;
		mode?: string;
		backend?: string;
		folderPath?: string;
	}>(req);
	if (!body) {
		return errorResponse("Invalid JSON body", 400);
	}
	const password = typeof body.password === "string" ? body.password : "";
	if (!password.trim()) {
		return errorResponse("password is required", 400);
	}
	const mode = parseEnableMode(body.mode);
	const backend = parseEnableBackend(body.backend);
	if (body.backend !== undefined && body.backend !== "" && !backend) {
		return errorResponse("backend must be icloud or folder", 400);
	}
	const folderPath =
		typeof body.folderPath === "string" ? body.folderPath : undefined;
	if (backend === "folder" && !folderPath?.trim()) {
		return errorResponse("folderPath is required when backend is folder", 400);
	}
	try {
		const status = await enableSync({ password, mode, backend, folderPath });
		return jsonResponse(status);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return errorResponse(message, 400);
	}
}

export async function handleConfigSyncDisable(req: Request): Promise<Response> {
	const body = await readJsonBody<{ deleteCloud?: boolean }>(req);
	if (!body) {
		return errorResponse("Invalid JSON body", 400);
	}
	try {
		const status = await disableSync({
			deleteCloud: body.deleteCloud === true,
		});
		return jsonResponse(status);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return errorResponse(message, 400);
	}
}

export async function handleConfigSyncPush(): Promise<Response> {
	try {
		const result = await pushSnapshot({ force: true });
		return jsonResponse(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return errorResponse(message, 400);
	}
}

export async function handleConfigSyncPull(req: Request): Promise<Response> {
	const body = await readJsonBody<{ confirm?: boolean }>(req);
	if (!body) {
		return errorResponse("Invalid JSON body", 400);
	}
	if (body.confirm !== true) {
		return errorResponse("confirm must be true to apply a sync snapshot", 400);
	}
	try {
		const result = await pullSnapshot({ confirm: true });
		return jsonResponse(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return errorResponse(message, 400);
	}
}

export async function handleConfigSyncHistory(): Promise<Response> {
	try {
		const history = await listSyncHistory();
		return jsonResponse({ history });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return errorResponse(message, 400);
	}
}

export async function handleConfigSyncRestoreHistory(
	req: Request,
): Promise<Response> {
	const body = await readJsonBody<{
		filename?: string;
		confirm?: boolean;
	}>(req);
	if (!body) {
		return errorResponse("Invalid JSON body", 400);
	}
	if (body.confirm !== true) {
		return errorResponse(
			"confirm must be true to restore a history snapshot",
			400,
		);
	}
	const filename = typeof body.filename === "string" ? body.filename : "";
	if (!filename.trim()) {
		return errorResponse("filename is required", 400);
	}
	try {
		const result = await restoreSyncHistory({
			filename: filename.trim(),
			confirm: true,
		});
		return jsonResponse(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return errorResponse(message, 400);
	}
}

function parseEnableMode(value: unknown): SyncEnableMode | undefined {
	if (value === "create" || value === "join" || value === "replace") {
		return value;
	}
	return undefined;
}

function parseEnableBackend(value: unknown): SyncBackend | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return isSyncBackend(trimmed) ? trimmed : undefined;
}
