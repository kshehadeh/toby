import {
	getChatInboundDisabledReason,
	resolveActiveChatInbound,
} from "../config/chat-inbound";
import { daemonLog } from "../logging/daemon-log";
import { createInboundEmitHandler, ensureModuleConnected } from "./router";
import { resetChatInboundStatus, setChatInboundStatus } from "./status";

export async function startChatInboundListeners(
	signal: AbortSignal,
): Promise<void> {
	const active = resolveActiveChatInbound();
	if (!active) {
		resetChatInboundStatus();
		const reason =
			getChatInboundDisabledReason() ??
			"chatInbound not configured or disabled";
		daemonLog("info", "inbound", "inbound_disabled", { reason });
		return;
	}

	daemonLog("info", "inbound", "inbound_starting", {
		integration: active.module.name,
		persona: active.persona.name,
	});

	const connected = await ensureModuleConnected(active.module);
	if (!connected) {
		const detail = `${active.module.displayName} is not connected.`;
		setChatInboundStatus({
			integration: active.module.name,
			status: "error",
			detail,
		});
		daemonLog("error", "inbound", "inbound_not_connected", {
			integration: active.module.name,
			detail,
		});
		return;
	}

	const provider = active.module.chatInbound;
	if (!provider) {
		const detail = "Integration does not implement chatInbound.";
		setChatInboundStatus({
			integration: active.module.name,
			status: "error",
			detail,
		});
		daemonLog("error", "inbound", "inbound_no_provider", {
			integration: active.module.name,
		});
		return;
	}

	setChatInboundStatus({
		integration: active.module.name,
		status: "connecting",
		detail: null,
	});
	daemonLog("info", "inbound", "inbound_connecting", {
		integration: active.module.name,
	});

	const emit = createInboundEmitHandler(active);
	let dispose: (() => void) | undefined;

	try {
		dispose = await provider.start({
			persona: active.persona,
			dryRun: active.dryRun,
			signal,
			emit,
		});
		setChatInboundStatus({
			integration: active.module.name,
			status: "connected",
			detail: null,
		});
		daemonLog("info", "inbound", "inbound_connected", {
			integration: active.module.name,
			persona: active.persona.name,
			transport: active.module.inboundTransport ?? active.module.name,
		});
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		setChatInboundStatus({
			integration: active.module.name,
			status: "error",
			detail: msg,
		});
		daemonLog("error", "inbound", "inbound_connect_failed", {
			integration: active.module.name,
			message: msg,
		});
		return;
	}

	await new Promise<void>((resolve) => {
		if (signal.aborted) {
			resolve();
			return;
		}
		signal.addEventListener(
			"abort",
			() => {
				dispose?.();
				setChatInboundStatus({
					integration: active.module.name,
					status: "idle",
					detail: "Stopped.",
				});
				daemonLog("info", "inbound", "inbound_stopped", {
					integration: active.module.name,
				});
				resolve();
			},
			{ once: true },
		);
	});
}
