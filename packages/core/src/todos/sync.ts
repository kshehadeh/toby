import { randomUUID } from "node:crypto";
import path from "node:path";
import { resolveTobyDir } from "../config/index";
import { isICloudDriveFolderAvailable } from "../config/sync-blob-store";
import { getSyncBlobStore } from "../config/sync-engine";
import {
	isFolderSyncPickedAvailable,
	resolveSyncBackend,
} from "../config/sync-folder";
import { getSyncPassphrase } from "../config/sync-keychain";
import { readSyncState } from "../config/sync-state";
import type { SqliteDb } from "../session-store";
import {
	acknowledgeTodoRestore,
	todosNeedRestoreReview,
} from "./restore-state";
import { todoReplica } from "./service";
import { applyOperation, hash, todoDb } from "./store";
import {
	MAX_BATCH_OPERATIONS,
	decryptTodoBatch,
	encryptTodoBatch,
} from "./sync-crypto";
import {
	type TodoBatchStore,
	createNativeTodoBatchStore,
	createTodoBatchStore,
} from "./sync-files";
import type { TodoOperation } from "./types";

const attached = new WeakSet<SqliteDb>();
function syncDb() {
	const db = todoDb();
	if (attached.has(db)) return db;
	db.query("ATTACH DATABASE $path AS todo_device").run({
		$path: path.join(resolveTobyDir(), "todo-device.sqlite"),
	});
	db.exec(`
CREATE TABLE IF NOT EXISTS todo_device.files (
 destination TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(destination,name)
);
CREATE TABLE IF NOT EXISTS todo_device.published (
 destination TEXT NOT NULL, operation_id TEXT NOT NULL,
 PRIMARY KEY(destination,operation_id)
);
CREATE TABLE IF NOT EXISTS todo_device.state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
	attached.add(db);
	return db;
}

function syncValue(key: string): string | null {
	return (
		(
			syncDb()
				.query("SELECT value FROM todo_device.state WHERE key=$key")
				.get({ $key: key }) as { value: string } | null
		)?.value ?? null
	);
}
function setSyncValue(key: string, value: string): void {
	syncDb()
		.query(
			"INSERT OR REPLACE INTO todo_device.state(key,value) VALUES($key,$value)",
		)
		.run({ $key: key, $value: value });
}
export function todoSyncStatus() {
	const destination = syncValue("destination");
	const pending = (
		syncDb()
			.query(`
SELECT COUNT(*) AS count FROM todo_operations o WHERE NOT EXISTS (
 SELECT 1 FROM todo_device.published p WHERE p.destination=$destination AND p.operation_id=o.id
)`)
			.get({ $destination: destination ?? "" }) as { count: number }
	).count;
	return {
		pausedForRestore: todosNeedRestoreReview(),
		lastSuccess: syncValue("lastSuccess") || null,
		error: syncValue("error") || null,
		pending,
	};
}

/** Pull first, even with pending local edits. Each validated file commits atomically. */
export async function exchangeTodoBatches(options: {
	store: TodoBatchStore;
	password: string;
	isCurrent?: () => boolean;
}): Promise<{
	pulled: number;
	published: number;
	uploadedBytes: number;
	downloadedBytes: number;
}> {
	const home = resolveTobyDir();
	const current = () => {
		if (
			home !== resolveTobyDir() ||
			options.isCurrent?.() === false ||
			todosNeedRestoreReview()
		)
			throw new Error(
				"Todo sync context changed. Retry after reviewing sync settings.",
			);
	};
	current();
	const db = syncDb();
	const destination = hash(options.store.rootDir);
	setSyncValue("destination", destination);
	const result = {
		pulled: 0,
		published: 0,
		uploadedBytes: 0,
		downloadedBytes: 0,
	};
	const names = await options.store.list();
	current();
	for (const name of names) {
		if (
			db
				.query(
					"SELECT 1 FROM todo_device.files WHERE destination=$destination AND name=$name",
				)
				.get({ $destination: destination, $name: name })
		)
			continue;
		const contents = await options.store.read(name);
		current();
		const operations = await decryptTodoBatch(contents, options.password);
		current();
		db.transaction(() => {
			for (const operation of operations) {
				if (applyOperation(operation)) result.pulled++;
				db.query(
					"INSERT OR IGNORE INTO todo_device.published(destination,operation_id) VALUES($destination,$id)",
				).run({ $destination: destination, $id: operation.id });
			}
			db.query(
				"INSERT INTO todo_device.files(destination,name) VALUES($destination,$name)",
			).run({ $destination: destination, $name: name });
		})();
		result.downloadedBytes += Buffer.byteLength(contents);
	}
	for (;;) {
		current();
		const rows = db
			.query(`
SELECT data FROM todo_operations o WHERE NOT EXISTS (
 SELECT 1 FROM todo_device.published p WHERE p.destination=$destination AND p.operation_id=o.id
) ORDER BY clock,replica,id LIMIT $limit`)
			.all({ $destination: destination, $limit: MAX_BATCH_OPERATIONS }) as {
			data: string;
		}[];
		if (!rows.length) break;
		const batch: TodoOperation[] = [];
		let bytes = 0;
		for (const row of rows) {
			const size = Buffer.byteLength(row.data);
			if (bytes + size > 900000 && batch.length) break;
			batch.push(JSON.parse(row.data) as TodoOperation);
			bytes += size;
		}
		const contents = JSON.stringify(
			await encryptTodoBatch(batch, options.password),
		);
		current();
		const name = `${todoReplica()}/${randomUUID()}.json`;
		await options.store.write(name, contents);
		current();
		db.transaction(() => {
			for (const operation of batch)
				db.query(
					"INSERT OR IGNORE INTO todo_device.published(destination,operation_id) VALUES($destination,$id)",
				).run({ $destination: destination, $id: operation.id });
			db.query(
				"INSERT OR IGNORE INTO todo_device.files(destination,name) VALUES($destination,$name)",
			).run({ $destination: destination, $name: name });
		})();
		result.published += batch.length;
		result.uploadedBytes += Buffer.byteLength(contents);
	}
	return result;
}

let inFlight: Promise<unknown> | null = null;
export async function runTodoSyncTick(): Promise<unknown> {
	if (inFlight) return inFlight;
	const home = resolveTobyDir();
	const state = readSyncState();
	if (!state.enabled || todosNeedRestoreReview()) return { paused: true };
	const store = getSyncBlobStore(state);
	const generation = hash([
		home,
		state.backend,
		state.folderPath,
		state.deviceId,
	]);
	const isCurrent = () => {
		const next = readSyncState();
		return (
			next.enabled &&
			generation ===
				hash([resolveTobyDir(), next.backend, next.folderPath, next.deviceId])
		);
	};
	inFlight = (async () => {
		try {
			const backend = resolveSyncBackend(state.backend);
			if (
				!process.env.TOBY_SYNC_DIR?.trim() &&
				(backend === "folder"
					? !isFolderSyncPickedAvailable(state.folderPath)
					: !isICloudDriveFolderAvailable())
			)
				throw new Error(
					"The todo sync destination is unavailable. Reconnect it in Sync and Backup.",
				);
			const password = await getSyncPassphrase();
			if (!password)
				throw new Error(
					"Unlock Sync and Backup with the sync password to sync todos.",
				);
			const batchStore =
				backend === "icloud" && !process.env.TOBY_SYNC_DIR?.trim()
					? createNativeTodoBatchStore(store.rootDir)
					: createTodoBatchStore(store.rootDir);
			const result = await exchangeTodoBatches({
				store: batchStore,
				password,
				isCurrent,
			});
			if (isCurrent()) {
				setSyncValue("lastSuccess", new Date().toISOString());
				setSyncValue("error", "");
			}
			return result;
		} catch (error) {
			if (home === resolveTobyDir())
				setSyncValue(
					"error",
					error instanceof Error ? error.message : "Todo sync failed.",
				);
			throw error;
		} finally {
			inFlight = null;
		}
	})();
	return inFlight;
}

/** The caller must first show the restored snapshot and obtain explicit approval. */
export function reconcileRestoredTodos(): void {
	if (!todosNeedRestoreReview()) return;
	const db = syncDb();
	db.transaction(() => {
		db.exec(
			"DELETE FROM todo_device.files; DELETE FROM todo_device.published; DELETE FROM todo_device.state;",
		);
	})();
	acknowledgeTodoRestore();
}

/** Independent from recording/database backup jobs. */
export async function runTodoSyncLoop(options: {
	signal: AbortSignal;
}): Promise<void> {
	let retryMs = 5000;
	while (!options.signal.aborted) {
		try {
			await runTodoSyncTick();
			retryMs = 5000;
		} catch {
			retryMs = Math.min(retryMs * 2, 60000);
		}
		if (options.signal.aborted) break;
		await new Promise<void>((resolve) => {
			const finish = () => {
				clearTimeout(timer);
				options.signal.removeEventListener("abort", finish);
				resolve();
			};
			const timer = setTimeout(finish, retryMs);
			options.signal.addEventListener("abort", finish, { once: true });
		});
	}
}
