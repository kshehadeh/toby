import type { AskUserToolResult } from "@toby/core/ai/ask-user-tool";
import type { ChatEvent } from "@toby/core/chat-pipeline/chat-events";
import type {
	AskUserPromptPayload,
	ChatSessionSettings,
	TurnDonePayload,
} from "@toby/core/api/chat-api";
import type { Persona } from "@toby/core/config/index";
import { getWebConfig } from "@toby/core/config/index";
import type { IntegrationModule } from "@toby/core/integrations/types";
import {
	resolveDaemonBaseUrl,
	TobyDaemonClient,
	type StreamTurnOptions,
} from "@toby/core/web/client";
import { ServerEventLog } from "@toby/core/web/server-event-log";
import { ensureDaemonRunning } from "../../schedules/daemon-status";

export type DaemonChatBridgeOptions = {
	persona: Persona;
	modules: readonly IntegrationModule[];
	dryRun: boolean;
};

export class DaemonChatBridge {
	private client: TobyDaemonClient | null = null;
	private readonly options: DaemonChatBridgeOptions;
	private readonly eventLog = new ServerEventLog();
	private activeTurnId: string | null = null;
	private activeAbort: AbortController | null = null;
	readonly daemonBaseUrl: string;
	readonly serverEventLogPath: string;

	constructor(options: DaemonChatBridgeOptions) {
		this.options = options;
		this.daemonBaseUrl = resolveDaemonBaseUrl(getWebConfig().port);
		this.serverEventLogPath = this.eventLog.path;
	}

	async connect(): Promise<TobyDaemonClient> {
		const web = getWebConfig();
		if (!web.enabled) {
			throw new Error(
				"Web API is disabled. Enable web.enabled in ~/.toby/config.json.",
			);
		}
		const daemon = await ensureDaemonRunning();
		if (!daemon.running) {
			throw new Error("Could not start Toby daemon.");
		}
		const client = new TobyDaemonClient({
			baseUrl: resolveDaemonBaseUrl(web.port),
			eventLog: this.eventLog,
		});
		await client.fetchStatus();
		this.client = client;
		return client;
	}

	private requireClient(): TobyDaemonClient {
		if (!this.client) {
			throw new Error("Daemon client not connected. Call connect() first.");
		}
		return this.client;
	}

	updatePersona(persona: Persona): void {
		this.options.persona = persona;
	}

	updateModules(modules: readonly IntegrationModule[]): void {
		this.options.modules = modules;
	}

	sessionSettings(): ChatSessionSettings {
		return {
			persona: this.options.persona.name,
			modules: this.options.modules.map((m) => m.name),
			dryRun: this.options.dryRun,
		};
	}

	async createSession(params?: {
		readonly bootstrap?: boolean;
	}): Promise<{ id: string; name: string }> {
		const client = this.requireClient();
		const created = await client.createSession({
			...this.sessionSettings(),
			bootstrap: params?.bootstrap ?? true,
		});
		return { id: created.id, name: created.name };
	}

	async loadSession(sessionId: string) {
		return this.requireClient().fetchSession(sessionId);
	}

	async listSessions(limit = 20) {
		return this.requireClient().listSessions(limit);
	}

	async patchSessionSettings(
		sessionId: string,
		patch: Partial<ChatSessionSettings & { name: string }>,
	) {
		return this.requireClient().patchSession(sessionId, patch);
	}

	cancelActiveTurn(sessionId: string): void {
		const turnId = this.activeTurnId;
		const abort = this.activeAbort;
		if (abort) {
			abort.abort();
		}
		if (turnId) {
			void this.requireClient()
				.cancelTurn(sessionId, turnId)
				.catch(() => {});
		}
	}

	async submitTurn(params: {
		readonly sessionId: string;
		readonly text: string;
		readonly steering?: boolean;
		readonly onEvent: (event: ChatEvent) => void;
		readonly onAskUser?: (
			prompt: AskUserPromptPayload & { turnId: string },
		) => Promise<AskUserToolResult>;
	}): Promise<TurnDonePayload> {
		const client = this.requireClient();
		const abort = new AbortController();
		this.activeAbort = abort;

		const streamOptions: StreamTurnOptions = {
			sessionId: params.sessionId,
			text: params.text,
			persona: this.options.persona.name,
			modules: this.options.modules.map((m) => m.name),
			dryRun: this.options.dryRun,
			steering: params.steering,
			onEvent: params.onEvent,
			signal: abort.signal,
			onAskUser: params.onAskUser
				? async (prompt) => {
						const answer = await params.onAskUser!(prompt);
						return {
							selectedIndex: answer.selectedIndex,
							selectedLabel: answer.selectedLabel,
							rawInput: answer.rawInput,
						};
					}
				: undefined,
		};

		try {
			const done = await client.streamTurn(streamOptions);
			this.activeTurnId = done.turnId || null;
			return done;
		} finally {
			this.activeAbort = null;
		}
	}

	async skipPlanPhase(
		sessionId: string,
		planId: string,
		phaseId: string,
	): Promise<void> {
		await this.requireClient().skipPlanPhase(sessionId, planId, phaseId);
	}

	async cancelPlanApi(sessionId: string, planId: string): Promise<void> {
		await this.requireClient().cancelPlan(sessionId, planId);
	}
}
