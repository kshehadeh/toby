import { getChatInboundStatus } from "../../chat-inbound/status";
import {
	getChatInboundDisabledReason,
	readChatInboundConfig,
} from "../../config/chat-inbound";
import { spawnDetachedDaemonRestart } from "../../daemon/spawn-restart";
import { getDaemonRuntimeInfo } from "../../daemon/status";
import { getIntegrationModule } from "../../integrations/index";
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
