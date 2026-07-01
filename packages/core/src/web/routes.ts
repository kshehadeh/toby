import fs from "node:fs";
import path from "node:path";
import {
	getDefaultPersonaImagePath,
	resolvePersonaImagePath,
} from "../config/index";
import { handleChangelog } from "./handlers/changelog";
import {
	handleAskUserAnswer,
	handleCancelTurn,
	handleChatStatusDetail,
	handleCreateSession,
	handleDeleteSession,
	handlePatchSession,
	handleSessionBootstrap,
	handleSessionPlanDetail,
	handleSessionTurn,
} from "./handlers/chat";
import {
	handleConfigureAction,
	handleConfigurePatch,
	handleConfigureSectionDetail,
	handleConfigureSections,
	handleConfigureTree,
	handleParseCron,
	handleScheduleRunDetail,
} from "./handlers/configure";
import {
	handleDaemonRestart,
	handleDaemonStatus,
	handleDaemonStop,
} from "./handlers/daemon";
import {
	handleIntegrationConnect,
	handleIntegrationDisconnect,
	handleIntegrationReauthorize,
	handleIntegrationSetup,
	handleIntegrationSetupGuide,
	handleIntegrationStatus,
} from "./handlers/integrations";
import { handleCreateIssue } from "./handlers/issues";
import {
	handleListenRecordingDelete,
	handleListenRecordingDetail,
	handleListenRecordingPatch,
	handleListenRecordingTranscribe,
	handleListenRecordingsList,
	handleListenStart,
	handleListenStatus,
	handleListenStop,
} from "./handlers/listen";
import {
	handleMemoriesList,
	handleMemoryDetail,
	handleMemoryExplain,
} from "./handlers/memories";
import {
	handleAIProviders,
	handleModulesList,
	handlePersonaDetail,
	handlePersonasList,
	handleSkillDetail,
	handleSkillsList,
} from "./handlers/metadata";
import { handlePlanCancel, handlePlanSkip } from "./handlers/plan";
import { handlePluginIcon, handlePluginsList } from "./handlers/plugins";
import { handleSessionDetail, handleSessionsList } from "./handlers/sessions";
import { errorResponse, jsonResponse } from "./http-utils";
import { resolveIconStaticDir } from "./static-path";

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
	staticDir?: string | null,
): Promise<Response> {
	const url = new URL(req.url);
	const { pathname } = url;

	if (pathname.startsWith("/api/")) {
		if (pathname === "/api/health") {
			return jsonResponse({ ok: true, daemon: true });
		}
		if (pathname === "/api/issues" && req.method === "POST") {
			return handleCreateIssue(req);
		}
		if (pathname === "/api/status" && req.method === "GET") {
			return handleChatStatusDetail();
		}
		if (pathname === "/api/listen/status" && req.method === "GET") {
			return handleListenStatus();
		}
		if (pathname === "/api/listen/start" && req.method === "POST") {
			return handleListenStart();
		}
		if (pathname === "/api/listen/stop" && req.method === "POST") {
			return handleListenStop(req);
		}
		if (pathname === "/api/listen/recordings" && req.method === "GET") {
			return handleListenRecordingsList();
		}
		const listenRecordingMatch = /^\/api\/listen\/recordings\/([^/]+)$/.exec(
			pathname,
		);
		if (listenRecordingMatch && req.method === "GET") {
			return handleListenRecordingDetail(
				decodeURIComponent(listenRecordingMatch[1]),
			);
		}
		if (listenRecordingMatch && req.method === "PATCH") {
			return handleListenRecordingPatch(
				decodeURIComponent(listenRecordingMatch[1]),
				req,
			);
		}
		if (listenRecordingMatch && req.method === "DELETE") {
			return handleListenRecordingDelete(
				decodeURIComponent(listenRecordingMatch[1]),
			);
		}
		const listenRecordingTranscribeMatch =
			/^\/api\/listen\/recordings\/([^/]+)\/transcribe$/.exec(pathname);
		if (listenRecordingTranscribeMatch && req.method === "POST") {
			return handleListenRecordingTranscribe(
				decodeURIComponent(listenRecordingTranscribeMatch[1]),
				req,
			);
		}
		if (pathname === "/api/daemon/status" && req.method === "GET") {
			return handleDaemonStatus();
		}
		if (pathname === "/api/daemon/restart" && req.method === "POST") {
			return handleDaemonRestart();
		}
		if (pathname === "/api/daemon/stop" && req.method === "POST") {
			return handleDaemonStop();
		}
		if (pathname === "/api/sessions" && req.method === "GET") {
			return handleSessionsList(url);
		}
		if (pathname === "/api/sessions" && req.method === "POST") {
			return handleCreateSession(req);
		}
		if (pathname === "/api/personas" && req.method === "GET") {
			return handlePersonasList();
		}
		if (pathname === "/api/ai/providers" && req.method === "GET") {
			return handleAIProviders();
		}
		const personaDetailMatch = /^\/api\/personas\/([^/]+)$/.exec(pathname);
		if (personaDetailMatch && req.method === "GET") {
			return handlePersonaDetail(decodeURIComponent(personaDetailMatch[1]));
		}
		const personaImageMatch = /^\/api\/personas\/image\/([^/]+)$/.exec(
			pathname,
		);
		if (personaImageMatch && req.method === "GET") {
			const filename = decodeURIComponent(personaImageMatch[1]);
			const filePath =
				filename === "default.png"
					? getDefaultPersonaImagePath()
					: resolvePersonaImagePath(filename);
			if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
				const body = fs.readFileSync(filePath);
				return new Response(body, {
					headers: { "Content-Type": contentTypeForPath(filePath) },
				});
			}
			return errorResponse("Image not found", 404);
		}
		if (pathname === "/api/modules" && req.method === "GET") {
			return handleModulesList();
		}
		if (pathname === "/api/skills" && req.method === "GET") {
			return handleSkillsList();
		}
		const skillDetailMatch = /^\/api\/skills\/([^/]+)$/.exec(pathname);
		if (skillDetailMatch && req.method === "GET") {
			return handleSkillDetail(decodeURIComponent(skillDetailMatch[1]));
		}
		if (pathname === "/api/releases/changelog" && req.method === "GET") {
			return handleChangelog(url);
		}
		if (pathname === "/api/plugins" && req.method === "GET") {
			return handlePluginsList();
		}
		const pluginIconMatch = /^\/api\/plugins\/([^/]+)\/icon$/.exec(pathname);
		if (pluginIconMatch && req.method === "GET") {
			return handlePluginIcon(pluginIconMatch[1]);
		}
		const sessionTurnCancelMatch =
			/^\/api\/sessions\/([^/]+)\/turn\/([^/]+)\/cancel$/.exec(pathname);
		if (sessionTurnCancelMatch && req.method === "POST") {
			return handleCancelTurn(
				decodeURIComponent(sessionTurnCancelMatch[1]),
				decodeURIComponent(sessionTurnCancelMatch[2]),
			);
		}
		const sessionAskUserMatch =
			/^\/api\/sessions\/([^/]+)\/turn\/([^/]+)\/ask-user\/([^/]+)$/.exec(
				pathname,
			);
		if (sessionAskUserMatch && req.method === "POST") {
			return handleAskUserAnswer(
				decodeURIComponent(sessionAskUserMatch[1]),
				decodeURIComponent(sessionAskUserMatch[2]),
				decodeURIComponent(sessionAskUserMatch[3]),
				req,
			);
		}
		const sessionTurnMatch = /^\/api\/sessions\/([^/]+)\/turn$/.exec(pathname);
		if (sessionTurnMatch && req.method === "POST") {
			return handleSessionTurn(decodeURIComponent(sessionTurnMatch[1]), req);
		}
		const sessionBootstrapMatch = /^\/api\/sessions\/([^/]+)\/bootstrap$/.exec(
			pathname,
		);
		if (sessionBootstrapMatch && req.method === "POST") {
			return handleSessionBootstrap(
				decodeURIComponent(sessionBootstrapMatch[1]),
				req,
			);
		}
		const sessionPlanSkipMatch = /^\/api\/sessions\/([^/]+)\/plan\/skip$/.exec(
			pathname,
		);
		if (sessionPlanSkipMatch && req.method === "POST") {
			return handlePlanSkip(decodeURIComponent(sessionPlanSkipMatch[1]), req);
		}
		const sessionPlanCancelMatch =
			/^\/api\/sessions\/([^/]+)\/plan\/cancel$/.exec(pathname);
		if (sessionPlanCancelMatch && req.method === "POST") {
			return handlePlanCancel(
				decodeURIComponent(sessionPlanCancelMatch[1]),
				req,
			);
		}
		const sessionPlanMatch = /^\/api\/sessions\/([^/]+)\/plan$/.exec(pathname);
		if (sessionPlanMatch && req.method === "GET") {
			return handleSessionPlanDetail(decodeURIComponent(sessionPlanMatch[1]));
		}
		const sessionMatch = /^\/api\/sessions\/([^/]+)$/.exec(pathname);
		if (sessionMatch && req.method === "GET") {
			return handleSessionDetail(decodeURIComponent(sessionMatch[1]));
		}
		if (sessionMatch && req.method === "PATCH") {
			return handlePatchSession(decodeURIComponent(sessionMatch[1]), req);
		}
		if (sessionMatch && req.method === "DELETE") {
			return handleDeleteSession(decodeURIComponent(sessionMatch[1]));
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
		if (pathname === "/api/configure/sections" && req.method === "GET") {
			return handleConfigureSections();
		}
		const configureSectionDetailMatch =
			/^\/api\/configure\/sections\/([^/]+)$/.exec(pathname);
		if (configureSectionDetailMatch && req.method === "GET") {
			return handleConfigureSectionDetail(
				decodeURIComponent(configureSectionDetailMatch[1]),
			);
		}
		if (pathname === "/api/configure/values" && req.method === "PATCH") {
			return handleConfigurePatch(req);
		}
		const actionMatch = /^\/api\/configure\/actions\/([^/]+)$/.exec(pathname);
		if (actionMatch && req.method === "POST") {
			return handleConfigureAction(decodeURIComponent(actionMatch[1]), req);
		}
		const scheduleRunMatch = /^\/api\/schedules\/runs\/([^/]+)$/.exec(pathname);
		if (scheduleRunMatch && req.method === "GET") {
			return handleScheduleRunDetail(decodeURIComponent(scheduleRunMatch[1]));
		}
		if (pathname === "/api/schedules/parse-cron" && req.method === "POST") {
			return handleParseCron(req);
		}
		const integrationStatusMatch =
			/^\/api\/integrations\/([^/]+)\/status$/.exec(pathname);
		if (integrationStatusMatch && req.method === "GET") {
			return handleIntegrationStatus(
				decodeURIComponent(integrationStatusMatch[1]),
			);
		}
		const integrationSetupGuideMatch =
			/^\/api\/integrations\/([^/]+)\/setup-guide$/.exec(pathname);
		if (integrationSetupGuideMatch && req.method === "GET") {
			return handleIntegrationSetupGuide(
				decodeURIComponent(integrationSetupGuideMatch[1]),
			);
		}
		const integrationActionMatch =
			/^\/api\/integrations\/([^/]+)\/(connect|disconnect|reauthorize|setup)$/.exec(
				pathname,
			);
		if (integrationActionMatch && req.method === "POST") {
			const name = decodeURIComponent(integrationActionMatch[1]);
			const action = integrationActionMatch[2];
			switch (action) {
				case "connect":
					return handleIntegrationConnect(name);
				case "disconnect":
					return handleIntegrationDisconnect(name);
				case "reauthorize":
					return handleIntegrationReauthorize(name);
				case "setup":
					return handleIntegrationSetup(name);
			}
		}
		return errorResponse("Not found", 404);
	}

	// Serve icon assets from packages/core/assets/icons/
	if (pathname.startsWith("/icons/") && req.method === "GET") {
		const iconsDir = resolveIconStaticDir();
		if (iconsDir) {
			const iconPath = pathname.slice("/icons".length);
			const response = serveStatic(iconsDir, iconPath);
			if (response) return response;
		}
	}

	// No static web UI to serve; return 404 for non-API routes.
	return errorResponse("Not found", 404);
}
