import fs from "node:fs";
import path from "node:path";
import type { PluginIconAsset, PluginInvocationTarget } from "./protocol";

const ALLOWED_ICON_MIME_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
]);

export function isAllowedPluginIconMimeType(
	mimeType: string,
): mimeType is NonNullable<PluginIconAsset["mimeType"]> {
	return ALLOWED_ICON_MIME_TYPES.has(mimeType);
}

export function pluginIconUrl(name: string): string {
	return `/api/plugins/${encodeURIComponent(name)}/icon`;
}

export function pluginIconContentType(
	asset: PluginIconAsset,
): NonNullable<PluginIconAsset["mimeType"]> | null {
	if (asset.mimeType) {
		return isAllowedPluginIconMimeType(asset.mimeType) ? asset.mimeType : null;
	}

	switch (path.extname(asset.path).toLowerCase()) {
		case ".png":
			return "image/png";
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".webp":
			return "image/webp";
		default:
			return null;
	}
}

export function pluginIconAssetBasePath(
	target: PluginInvocationTarget,
): string {
	return target.kind === "bun-package"
		? target.cwd
		: path.dirname(target.executablePath);
}

export function resolvePluginIconAssetPath(
	target: PluginInvocationTarget,
	asset: PluginIconAsset | undefined,
): string | null {
	if (
		!asset?.path ||
		asset.path.includes("\0") ||
		path.isAbsolute(asset.path)
	) {
		return null;
	}

	const basePath = path.resolve(pluginIconAssetBasePath(target));
	const resolvedPath = path.resolve(basePath, asset.path);
	if (
		resolvedPath !== basePath &&
		!resolvedPath.startsWith(`${basePath}${path.sep}`)
	) {
		return null;
	}

	return resolvedPath;
}

export function readPluginIconAsset(
	target: PluginInvocationTarget,
	asset: PluginIconAsset | undefined,
):
	| {
			readonly ok: true;
			readonly bytes: Buffer;
			readonly contentType: NonNullable<PluginIconAsset["mimeType"]>;
			readonly stat: fs.Stats;
	  }
	| { readonly ok: false; readonly status: 400 | 404; readonly error: string } {
	const contentType = asset ? pluginIconContentType(asset) : null;
	if (!asset || !contentType) {
		return { ok: false, status: 404, error: "Plugin icon not found" };
	}

	const filePath = resolvePluginIconAssetPath(target, asset);
	if (!filePath) {
		return { ok: false, status: 400, error: "Invalid plugin icon path" };
	}

	try {
		const stat = fs.statSync(filePath);
		if (!stat.isFile()) {
			return { ok: false, status: 404, error: "Plugin icon not found" };
		}
		return {
			ok: true,
			bytes: fs.readFileSync(filePath),
			contentType,
			stat,
		};
	} catch {
		return { ok: false, status: 404, error: "Plugin icon not found" };
	}
}
