import fs from "node:fs";
import { clearModelListCache } from "../../ai/model-list";
import {
	createEncryptedConfigBackup,
	restoreConfigBackup,
} from "../../config/backup";
import { invalidateSettingsCache } from "../../configure/settings-cache";
import { spawnDetachedDaemonRestart } from "../../daemon/spawn-restart";
import { getDaemonLockPath, parseDaemonLock } from "../../daemon/status";
import { errorResponse, jsonResponse, readJsonBody } from "../http-utils";

function invalidateAfterRestore(): void {
	invalidateSettingsCache();
	clearModelListCache();
}

/**
 * POST /api/config/backup
 * Body: { password: string }
 * Returns encrypted backup JSON + suggested filename.
 */
export async function handleConfigBackup(req: Request): Promise<Response> {
	const body = await readJsonBody<{ password?: string }>(req);
	if (!body) {
		return errorResponse("Invalid JSON body", 400);
	}
	const password = typeof body.password === "string" ? body.password : "";
	if (!password.trim()) {
		return errorResponse("password is required", 400);
	}
	try {
		const result = await createEncryptedConfigBackup(password);
		return jsonResponse({
			backup: result.backup,
			suggestedFileName: result.suggestedFileName,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return errorResponse(message, 400);
	}
}

/**
 * POST /api/config/restore
 * Body: { backup: object, password?: string, confirm: true }
 */
export async function handleConfigRestore(req: Request): Promise<Response> {
	const body = await readJsonBody<{
		backup?: unknown;
		password?: string;
		confirm?: boolean;
	}>(req);
	if (!body) {
		return errorResponse("Invalid JSON body", 400);
	}
	if (body.confirm !== true) {
		return errorResponse(
			"confirm must be true to replace config.json and credentials.json",
			400,
		);
	}
	if (body.backup === undefined || body.backup === null) {
		return errorResponse("backup is required", 400);
	}
	const password =
		typeof body.password === "string" ? body.password : undefined;
	try {
		const restored = await restoreConfigBackup(body.backup, password);
		invalidateAfterRestore();
		const databasesStaged = restored.databases !== undefined;
		if (databasesStaged && isServingDaemon()) {
			// Flush the response before the detached restart stops this daemon.
			setTimeout(() => spawnDetachedDaemonRestart(), 200);
		}
		return jsonResponse({
			ok: true,
			databasesStaged,
			restarting: databasesStaged,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return errorResponse(message, 400);
	}
}

function isServingDaemon(): boolean {
	try {
		const lock = parseDaemonLock(fs.readFileSync(getDaemonLockPath(), "utf8"));
		return lock?.pid === process.pid;
	} catch {
		return false;
	}
}
