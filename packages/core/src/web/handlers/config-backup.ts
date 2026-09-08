import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearModelListCache } from "../../ai/model-list";
import {
	buildBackupFileName,
	createConfigBackupArchive,
	restoreConfigBackup,
	restoreConfigBackupFile,
} from "../../config/backup";
import { invalidateSettingsCache } from "../../configure/settings-cache";
import { spawnDetachedDaemonRestart } from "../../daemon/spawn-restart";
import { getDaemonLockPath, parseDaemonLock } from "../../daemon/status";
import { listenManager } from "../../listen/manager";
import { errorResponse, jsonResponse, readJsonBody } from "../http-utils";

function invalidateAfterRestore(): void {
	invalidateSettingsCache();
	clearModelListCache();
}

function isListenBusy(): boolean {
	const status = listenManager.status();
	return (
		status.status === "starting" ||
		status.status === "recording" ||
		status.status === "stopping"
	);
}

function isServingDaemon(): boolean {
	try {
		const lock = parseDaemonLock(fs.readFileSync(getDaemonLockPath(), "utf8"));
		return lock?.pid === process.pid;
	} catch {
		return false;
	}
}

/**
 * POST /api/config/backup
 * Body: { password: string }
 * Returns the encrypted backup archive as a binary stream.
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
	const filePath = path.join(
		os.tmpdir(),
		`toby-backup-${process.pid}-${Date.now()}.tbybak`,
	);
	let suggestedFileName = buildBackupFileName();
	let skipped: readonly string[] = [];
	try {
		const result = await createConfigBackupArchive(password, filePath);
		suggestedFileName = result.suggestedFileName;
		skipped = result.skipped;
	} catch (error) {
		fs.promises.unlink(filePath).catch(() => {});
		const message = error instanceof Error ? error.message : String(error);
		return errorResponse(message, 400);
	}
	// Stream the archive straight off disk so large recording libraries do
	// not pass through memory, and delete the temp file once it is sent.
	const source = Bun.file(filePath);
	const archiveStream = source.stream().pipeThrough(
		new TransformStream({
			flush() {
				fs.promises.unlink(filePath).catch(() => {});
			},
		}),
	);
	return new Response(archiveStream, {
		headers: {
			"Content-Type": "application/octet-stream",
			"Content-Disposition": `attachment; filename="${suggestedFileName}"`,
			"X-Toby-Backup-Filename": suggestedFileName,
			"X-Toby-Backup-Skipped": String(skipped.length),
			"Cache-Control": "no-store",
		},
	});
}

/**
 * POST /api/config/restore
 * Accepts either:
 *  - JSON body { backup: object, password?: string, confirm: true } (legacy), or
 *  - A binary archive upload (Content-Type: application/octet-stream) with
 *    X-Backup-Password and X-Backup-Confirm headers.
 */
export async function handleConfigRestore(req: Request): Promise<Response> {
	const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
	if (contentType.includes("application/octet-stream")) {
		return handleConfigRestoreArchiveUpload(req);
	}
	return handleConfigRestoreJson(req);
}

async function handleConfigRestoreJson(req: Request): Promise<Response> {
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
	if (isListenBusy()) {
		return errorResponse(
			"Stop the active recording before restoring a backup.",
			409,
		);
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

async function handleConfigRestoreArchiveUpload(
	req: Request,
): Promise<Response> {
	const password = req.headers.get("x-backup-password") ?? "";
	const confirm = (req.headers.get("x-backup-confirm") ?? "").toLowerCase();
	if (confirm !== "true") {
		return errorResponse("confirm must be true to replace your Toby data", 400);
	}
	if (!password.trim()) {
		return errorResponse("password is required", 400);
	}
	if (!req.body) {
		return errorResponse("backup is required", 400);
	}
	if (isListenBusy()) {
		return errorResponse(
			"Stop the active recording before restoring a backup.",
			409,
		);
	}
	const tempPath = path.join(
		os.tmpdir(),
		`toby-restore-${process.pid}-${Date.now()}.tbybak`,
	);
	try {
		// Stream the upload to disk; archives can hold full recording libraries.
		const sink = Bun.file(tempPath).writer();
		for await (const chunk of req.body) {
			await sink.write(chunk);
		}
		await sink.end();
		const staged = await restoreConfigBackupFile(tempPath, password);
		invalidateAfterRestore();
		const restorePending =
			staged.databasesStaged ||
			staged.projectsStaged ||
			staged.recordingsStaged;
		const restarting = restorePending && isServingDaemon();
		if (restarting) {
			// Flush the response before the detached restart stops this daemon.
			setTimeout(() => spawnDetachedDaemonRestart(), 200);
		}
		return jsonResponse({
			ok: true,
			...staged,
			restarting,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return errorResponse(message, 400);
	} finally {
		fs.promises.unlink(tempPath).catch(() => {});
	}
}
