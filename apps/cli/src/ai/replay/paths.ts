import fs from "node:fs";
import path from "node:path";
import { ensureTobyDir, resolveTobyDir } from "../../config/index";

export function getRecordingsDir(): string {
	return path.join(resolveTobyDir(), "recordings");
}

/** Resolve a recording path; bare filenames go under `~/.toby/recordings/`. */
export function resolveRecordingPath(file: string): string {
	const trimmed = file.trim();
	if (!trimmed) {
		throw new Error("Recording path must not be empty.");
	}
	if (path.isAbsolute(trimmed) || trimmed.includes(path.sep)) {
		return path.resolve(trimmed);
	}
	ensureTobyDir();
	const dir = getRecordingsDir();
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	return path.join(dir, trimmed);
}
