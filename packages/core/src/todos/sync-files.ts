import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
	isNativeServerAlive,
	nativeAppRequest,
	resolveNativePort,
} from "../native-app/client";
import { MAX_BATCH_BYTES } from "./sync-crypto";

export interface TodoBatchStore {
	readonly rootDir: string;
	list(): Promise<string[]>;
	read(name: string): Promise<string>;
	write(name: string, contents: string): Promise<void>;
}

export function validateBatchName(name: string): void {
	if (!/^[a-zA-Z0-9_-]{1,200}\/[a-zA-Z0-9_-]{1,200}\.json$/.test(name))
		throw new Error("Invalid todo batch filename.");
}

/** Only encrypted immutable batches live in this namespace. Never prune v1. */
export function createTodoBatchStore(rootDir: string): TodoBatchStore {
	const root = path.join(rootDir, "todos", "v1");
	async function checkPath(target: string): Promise<void> {
		let current = rootDir;
		for (const component of path.relative(rootDir, target).split(path.sep)) {
			current = path.join(current, component);
			try {
				if ((await fs.lstat(current)).isSymbolicLink())
					throw new Error("Todo sync paths must not contain symbolic links.");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
	}
	return {
		rootDir,
		async list() {
			await checkPath(root);
			const names: string[] = [];
			let replicas: string[];
			try {
				replicas = await fs.readdir(root);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
				throw error;
			}
			for (const replica of replicas) {
				if (!/^[a-zA-Z0-9_-]{1,200}$/.test(replica)) continue;
				const folder = path.join(root, replica);
				await checkPath(folder);
				if (!(await fs.stat(folder)).isDirectory()) continue;
				for (const file of await fs.readdir(folder)) {
					if (!/^[a-zA-Z0-9_-]{1,200}\.json$/.test(file)) continue;
					names.push(`${replica}/${file}`);
				}
			}
			return names.sort();
		},
		async read(name) {
			validateBatchName(name);
			const file = path.join(root, name);
			await checkPath(file);
			const handle = await fs.open(file, "r");
			try {
				if ((await handle.stat()).size > MAX_BATCH_BYTES)
					throw new Error("Todo batch is too large.");
				return await handle.readFile("utf8");
			} finally {
				await handle.close();
			}
		},
		async write(name, contents) {
			validateBatchName(name);
			if (Buffer.byteLength(contents) > MAX_BATCH_BYTES)
				throw new Error("Todo batch is too large.");
			const file = path.join(root, name);
			await checkPath(file);
			await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
			const temporary = path.join(path.dirname(file), `.${randomUUID()}.tmp`);
			try {
				await fs.writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
				// link is atomic and refuses to overwrite an existing immutable batch.
				await fs.link(temporary, file);
			} finally {
				await fs.unlink(temporary).catch(() => {});
			}
		},
	};
}

/** Coordinate iCloud placeholders when the app is already awake, never launch it. */
export function createNativeTodoBatchStore(rootDir: string): TodoBatchStore {
	const fallback = createTodoBatchStore(rootDir);
	async function nativeAvailable() {
		const port = resolveNativePort();
		return (
			port !== null && port !== undefined && (await isNativeServerAlive(port))
		);
	}
	return {
		rootDir,
		async list() {
			if (!(await nativeAvailable())) return fallback.list();
			const response = await nativeAppRequest("icloud/todos/list", {
				launch: false,
			});
			if (!response.ok || !Array.isArray(response.data?.files))
				throw new Error(
					response.error ?? "Could not list iCloud todo batches.",
				);
			const files = response.data.files as unknown[];
			for (const file of files) {
				if (typeof file !== "string")
					throw new Error("Invalid iCloud todo batch listing.");
				validateBatchName(file);
			}
			return files as string[];
		},
		async read(name) {
			validateBatchName(name);
			if (!(await nativeAvailable())) return fallback.read(name);
			const response = await nativeAppRequest("icloud/todos/read", {
				body: { name },
				launch: false,
			});
			if (!response.ok || typeof response.data?.contents !== "string")
				throw new Error(
					response.error ?? "Could not download the iCloud todo batch.",
				);
			if (Buffer.byteLength(response.data.contents) > MAX_BATCH_BYTES)
				throw new Error("Todo batch is too large.");
			return response.data.contents;
		},
		async write(name, contents) {
			validateBatchName(name);
			if (Buffer.byteLength(contents) > MAX_BATCH_BYTES)
				throw new Error("Todo batch is too large.");
			if (!(await nativeAvailable())) return fallback.write(name, contents);
			const response = await nativeAppRequest("icloud/todos/write", {
				body: { name, contents },
				launch: false,
			});
			if (!response.ok)
				throw new Error(
					response.error ?? "Could not publish the iCloud todo batch.",
				);
		},
	};
}
