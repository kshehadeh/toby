import { getChatInboundStatus } from "../../chat-inbound/status";
import {
	getChatInboundDisabledReason,
	readChatInboundConfig,
} from "../../config/chat-inbound";
import { spawnDetachedDaemonRestart } from "../../daemon/spawn-restart";
import { getDaemonRuntimeInfo } from "../../daemon/status";
import { getIntegrationModule } from "../../integrations/index";
import { listExternalSessionsForIntegration } from "../../session-store";
import { jsonResponse } from "../http-utils";

const RESTART_DEFER_MS = 200;
const STOP_DEFER_MS = 200;

export function handleDaemonStatus(): Response {
	const config = readChatInboundConfig();
	const runtime = getChatInboundStatus();
	const integrationName = config.integration?.trim() ?? null;
	const module = integrationName
		? getIntegrationModule(integrationName)
		: undefined;

	// Query durable lifecycle state for the active inbound integration.
	// This surfaces sessions that are awaiting user reply even when no
	// turn is actively processing (transient status is clear in that case).
	let awaitingUserSessions: Array<{
		externalKey: string;
		displayName: string | null;
	}> = [];
	if (integrationName && config.enabled === true) {
		awaitingUserSessions = listExternalSessionsForIntegration(integrationName)
			.filter((s) => s.lifecycleStatus === "awaiting_user")
			.map((s) => ({
				externalKey: s.externalKey,
				displayName: s.displayName,
			}));
	}

	return jsonResponse({
		process: getDaemonRuntimeInfo(),
		chatInbound: {
			enabled: config.enabled === true,
			integration: integrationName,
			integrationLabel: module?.displayName ?? integrationName,
			status: runtime.status,
			detail: runtime.detail,
			disabledReason: getChatInboundDisabledReason(),
			updatedAt: runtime.updatedAt,
			activeConversationName: runtime.activeConversationName,
			activeSince: runtime.activeSince,
			activeKind: runtime.activeKind,
			awaitingUserSessions,
		},
	});
}

export function handleDaemonRestart(): Response {
	setTimeout(() => {
		spawnDetachedDaemonRestart();
	}, RESTART_DEFER_MS);

	return jsonResponse({ ok: true, restarting: true });
}

export function handleDaemonStop(): Response {
	// The web server runs inside the daemon process, so stopping the daemon
	// means signalling our own process. Defer so the HTTP response flushes
	// before the SIGTERM handler tears everything down.
	setTimeout(() => {
		try {
			process.kill(process.pid, "SIGTERM");
		} catch {
			// Best effort — the daemon may already be exiting.
		}
	}, STOP_DEFER_MS);

	return jsonResponse({ ok: true, stopping: true });
}
