import type { ActiveChatInbound } from "../chat-inbound/types";
import { getIntegrationModule } from "../integrations/index";
import { resolveDefaultPersona, resolvePersona } from "../personas/index";
import type { ChatInboundConfig, Persona } from "./index";
import { readConfig } from "./index";

function envFlag(name: string): boolean | undefined {
	const v = process.env[name]?.trim().toLowerCase();
	if (v === "1" || v === "true" || v === "yes") return true;
	if (v === "0" || v === "false" || v === "no") return false;
	return undefined;
}

function envString(name: string): string | undefined {
	const v = process.env[name]?.trim();
	if (!v || v === "undefined" || v === "null") {
		return undefined;
	}
	return v;
}

export function readChatInboundConfig(): ChatInboundConfig {
	const cfg = readConfig() as { chatInbound?: ChatInboundConfig };
	const fromFile = cfg.chatInbound ?? {};
	const enabled = envFlag("TOBY_CHAT_INBOUND_ENABLED") ?? fromFile.enabled;
	const integration = envString("TOBY_CHAT_INBOUND_INTEGRATION") ?? fromFile.integration;
	const persona = envString("TOBY_CHAT_INBOUND_PERSONA") ?? fromFile.persona;
	return { enabled, integration, persona };
}

export function isIntegrationInboundEnabled(integrationName: string): boolean {
	const inboundCfg = readChatInboundConfig();
	if (
		inboundCfg.enabled === true &&
		inboundCfg.integration?.trim() === integrationName
	) {
		return true;
	}
	const cfg = readConfig();
	const entry = cfg.integrations[integrationName] as
		| { inboundEnabled?: boolean }
		| undefined;
	return entry?.inboundEnabled === true;
}

/** Why inbound is off; null when inbound would start. */
export function getChatInboundDisabledReason(): string | null {
	const inboundCfg = readChatInboundConfig();
	if (inboundCfg.enabled === false) {
		return 'chatInbound.enabled is false (or TOBY_CHAT_INBOUND_ENABLED=0). Set enabled: true in ~/.toby/config.json.';
	}
	const integrationName = inboundCfg.integration?.trim();
	if (!integrationName) {
		return 'chatInbound.integration is missing. Set e.g. "integration": "slack" under chatInbound in ~/.toby/config.json (or TOBY_CHAT_INBOUND_INTEGRATION=slack).';
	}
	if (!isIntegrationInboundEnabled(integrationName)) {
		return `Inbound is not enabled for "${integrationName}". In configure: turn on **Daemon / inbound chat** with **Active integration** set to "${integrationName}", or set **Daemon: listen for @mentions** to On under that integration.`;
	}
	const module = getIntegrationModule(integrationName);
	if (!module) {
		return `Unknown integration "${integrationName}". Use a connected chat integration that supports inbound (e.g. slack).`;
	}
	if (!module.chatInbound) {
		return `Integration "${integrationName}" does not implement inbound chat.`;
	}
	return null;
}

export function resolveActiveChatInbound(): ActiveChatInbound | null {
	const reason = getChatInboundDisabledReason();
	if (reason) {
		return null;
	}
	const inboundCfg = readChatInboundConfig();
	const integrationName = inboundCfg.integration?.trim();
	if (!integrationName) {
		return null;
	}
	const module = getIntegrationModule(integrationName);
	if (!module?.chatInbound) {
		return null;
	}
	const personaName = inboundCfg.persona?.trim();
	const persona: Persona = personaName
		? (resolvePersona(personaName) ?? resolveDefaultPersona())
		: resolveDefaultPersona();
	return {
		module,
		persona,
		dryRun: false,
	};
}
