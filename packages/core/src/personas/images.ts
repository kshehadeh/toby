import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPersonaImagesDir, resolvePersonaImagePath } from "../config/index";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolvePersonaStaticDir(): string | null {
	const candidates = [
		path.join(path.dirname(process.execPath), "personas"),
		path.resolve(__dirname, "../../assets/personas"),
		path.resolve(process.cwd(), "packages/core/assets/personas"),
	];
	for (const dir of candidates) {
		if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
			return dir;
		}
	}
	return null;
}

/**
 * Resolve a persona image for serving: user override in
 * `~/.toby/persona/images/`, then a bundled file from
 * `packages/core/assets/personas/`. `default.png` maps to the bundled Toby
 * portrait when the user has not seeded a default.
 */
export function resolvePersonaImageFile(filename: string): string | null {
	const safe = path.basename(filename);
	if (!safe || safe !== filename) {
		return null;
	}
	const userPath = resolvePersonaImagePath(safe);
	if (fs.existsSync(userPath) && fs.statSync(userPath).isFile()) {
		return userPath;
	}
	const bundledName = safe === "default.png" ? "toby.png" : safe;
	const bundledDir = resolvePersonaStaticDir();
	if (!bundledDir) {
		return null;
	}
	const bundledPath = path.join(bundledDir, bundledName);
	if (fs.existsSync(bundledPath) && fs.statSync(bundledPath).isFile()) {
		return bundledPath;
	}
	return null;
}

/** Public API path for a persona image, falling back to the bundled default. */
export function personaImageApiPath(imagePath?: string): string | undefined {
	const named = imagePath?.trim();
	if (named) {
		return `/api/personas/image/${encodeURIComponent(named)}`;
	}
	if (resolvePersonaImageFile("default.png")) {
		return "/api/personas/image/default.png";
	}
	return undefined;
}

/** Delete a user-uploaded persona image; never touches bundled assets. */
export function removeUserPersonaImage(imagePath: string): void {
	const userDir = path.resolve(getPersonaImagesDir());
	const userFile = path.resolve(
		resolvePersonaImagePath(path.basename(imagePath)),
	);
	if (!userFile.startsWith(`${userDir}${path.sep}`)) {
		return;
	}
	if (fs.existsSync(userFile) && fs.statSync(userFile).isFile()) {
		try {
			fs.unlinkSync(userFile);
		} catch {
			// ignore cleanup errors
		}
	}
}
