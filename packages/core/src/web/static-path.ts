import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isRunningAsCompiledBinary } from "../toby-spawn";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Resolve directory containing built web UI static assets. */
export function resolveWebStaticDir(): string | null {
	if (isRunningAsCompiledBinary()) {
		const sibling = path.join(path.dirname(process.execPath), "web");
		if (fs.existsSync(path.join(sibling, "index.html"))) {
			return sibling;
		}
		return null;
	}

	const candidates = [
		path.resolve(__dirname, "../../../../apps/web/dist"),
		path.resolve(process.cwd(), "apps/web/dist"),
	];
	for (const dir of candidates) {
		if (fs.existsSync(path.join(dir, "index.html"))) {
			return dir;
		}
	}
	return null;
}

/** Resolve directory containing server-served icon assets. */
export function resolveIconStaticDir(): string | null {
	if (isRunningAsCompiledBinary()) {
		const sibling = path.join(path.dirname(process.execPath), "icons");
		if (fs.existsSync(sibling)) {
			return sibling;
		}
		return null;
	}

	const candidates = [
		path.resolve(__dirname, "../../assets/icons"),
		path.resolve(process.cwd(), "packages/core/assets/icons"),
	];
	for (const dir of candidates) {
		if (fs.existsSync(dir)) {
			return dir;
		}
	}
	return null;
}

export function getWebUiUrl(port: number): string {
	return `http://127.0.0.1:${port}`;
}
