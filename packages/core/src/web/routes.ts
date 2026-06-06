import fs from "node:fs";
import path from "node:path";
import {
	handleConfigureAction,
	handleConfigurePatch,
	handleConfigureTree,
} from "./handlers/configure";
import { handleDaemonRestart, handleDaemonStatus } from "./handlers/daemon";
import {
	handleMemoriesList,
	handleMemoryDetail,
	handleMemoryExplain,
} from "./handlers/memories";
import { handleSessionDetail, handleSessionsList } from "./handlers/sessions";
import { errorResponse, jsonResponse } from "./http-utils";

function contentTypeForPath(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase();
	switch (ext) {
		case ".html":
			return "text/html; charset=utf-8";
		case ".js":
			return "application/javascript; charset=utf-8";
		case ".css":
			return "text/css; charset=utf-8";
		case ".json":
			return "application/json; charset=utf-8";
		case ".svg":
			return "image/svg+xml";
		case ".png":
			return "image/png";
		case ".ico":
			return "image/x-icon";
		case ".woff2":
			return "font/woff2";
		default:
			return "application/octet-stream";
	}
}

function serveStatic(staticDir: string, urlPath: string): Response | null {
	const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
	const relativePath = safePath.replace(/^\/+/, "");
	const filePath = path.join(
		staticDir,
		relativePath === "" ? "index.html" : relativePath,
	);
	if (!filePath.startsWith(staticDir)) {
		return errorResponse("Forbidden", 403);
	}
	if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
		const body = fs.readFileSync(filePath);
		return new Response(body, {
			headers: { "Content-Type": contentTypeForPath(filePath) },
		});
	}
	const indexPath = path.join(staticDir, "index.html");
	if (fs.existsSync(indexPath)) {
		return new Response(fs.readFileSync(indexPath), {
			headers: { "Content-Type": "text/html; charset=utf-8" },
		});
	}
	return null;
}

export async function handleWebRequest(
	req: Request,
	staticDir: string | null,
): Promise<Response> {
	const url = new URL(req.url);
	const { pathname } = url;

	if (pathname.startsWith("/api/")) {
		if (pathname === "/api/health") {
			return jsonResponse({ ok: true, daemon: true });
		}
		if (pathname === "/api/daemon/status" && req.method === "GET") {
			return handleDaemonStatus();
		}
		if (pathname === "/api/daemon/restart" && req.method === "POST") {
			return handleDaemonRestart();
		}
		if (pathname === "/api/sessions" && req.method === "GET") {
			return handleSessionsList(url);
		}
		const sessionMatch = /^\/api\/sessions\/([^/]+)$/.exec(pathname);
		if (sessionMatch && req.method === "GET") {
			return handleSessionDetail(decodeURIComponent(sessionMatch[1]));
		}
		if (pathname === "/api/memories" && req.method === "GET") {
			return handleMemoriesList(url);
		}
		const memoryExplainMatch = /^\/api\/memories\/([^/]+)\/explain$/.exec(
			pathname,
		);
		if (memoryExplainMatch && req.method === "GET") {
			return handleMemoryExplain(decodeURIComponent(memoryExplainMatch[1]));
		}
		const memoryMatch = /^\/api\/memories\/([^/]+)$/.exec(pathname);
		if (memoryMatch && req.method === "GET") {
			return handleMemoryDetail(decodeURIComponent(memoryMatch[1]));
		}
		if (pathname === "/api/configure/tree" && req.method === "GET") {
			return handleConfigureTree();
		}
		if (pathname === "/api/configure/values" && req.method === "PATCH") {
			return handleConfigurePatch(req);
		}
		const actionMatch = /^\/api\/configure\/actions\/([^/]+)$/.exec(pathname);
		if (actionMatch && req.method === "POST") {
			return handleConfigureAction(decodeURIComponent(actionMatch[1]), req);
		}
		return errorResponse("Not found", 404);
	}

	if (!staticDir) {
		return errorResponse(
			"Web UI not built. Run `bun run --cwd apps/web build`.",
			503,
		);
	}

	const staticResponse = serveStatic(staticDir, pathname);
	return staticResponse ?? errorResponse("Not found", 404);
}
