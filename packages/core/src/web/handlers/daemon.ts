import { getChatInboundStatus } from "../../chat-inbound/status";
import {
	getChatInboundDisabledReason,
	readChatInboundConfig,
} from "../../config/chat-inbound";
import { getIntegrationModule } from "../../integrations/index";
import { spawnDetachedDaemonRestart } from "../../daemon/spawn-restart";
import { jsonResponse } from "../http-utils";

const RESTART_DEFER_MS = 200;

export function handleDaemonStatus(): Response {
	const config = readChatInboundConfig();
	const runtime = getChatInboundStatus();
	const integrationName = config.integration?.trim() ?? null;
	const module = integrationName
		? getIntegrationModule(integrationName)
		: undefined;

	return jsonResponse({
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
