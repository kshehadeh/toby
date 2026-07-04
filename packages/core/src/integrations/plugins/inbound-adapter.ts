import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import readline from "node:readline";
import type {
	ChatInboundProvider,
	InboundChatEvent,
	InboundConversation,
	InboundStatusReporter,
} from "../../chat-inbound/types";
import type { ChatEvent } from "../../chat-pipeline/chat-events";
import { daemonLog } from "../../logging/daemon-log";
import {
	type PendingAskUser,
	listExternalSessionsForIntegration,
} from "../../session-store";
import { formatSlackInboundStatusMrkdwn } from "./inbound-slack-status-format";
import type {
	PluginExternalSessionSnapshot,
	PluginInboundChatEvent,
	PluginInboundFromCoreMessage,
	PluginInboundToCoreMessage,
	PluginInvocationTarget,
} from "./protocol";

const INBOUND_START_TIMEOUT_MS = 60_000;
const INBOUND_RPC_TIMEOUT_MS = 10_000;

type InboundBridge = {
	readonly write: (message: PluginInboundFromCoreMessage) => void;
	readonly requestPersonaAppendix: (
		conversation: InboundConversation,
	) => Promise<string>;
	readonly isAlive: () => boolean;
	readonly dispose: () => void;
};

function toInboundChatEvent(event: PluginInboundChatEvent): InboundChatEvent {
	return {
		integration: event.integration,
		externalKey: event.externalKey,
		messageId: event.messageId,
		text: event.text,
		authorId: event.authorId,
		isNewConversationTurn: event.isNewConversationTurn,
		conversation: event.conversation,
		botUserId: event.botUserId,
	};
}

function createStdoutDispatcher(params: {
	readonly onEvent: (event: InboundChatEvent) => void;
	readonly onReady: () => void;
	readonly onStartError: (message: string) => void;
}): {
	readonly handleLine: (line: string) => void;
	readonly registerAppendixWaiter: (
		requestId: string,
		resolve: (text: string) => void,
		reject: (err: Error) => void,
	) => void;
	readonly clearAppendixWaiters: (reason: string) => void;
} {
	const pendingAppendix = new Map<
		string,
		{ resolve: (text: string) => void; reject: (err: Error) => void }
	>();
	let readySeen = false;

	return {
		registerAppendixWaiter(requestId, resolve, reject) {
			pendingAppendix.set(requestId, { resolve, reject });
		},
		clearAppendixWaiters(reason) {
			for (const [, pending] of pendingAppendix) {
				pending.reject(new Error(reason));
			}
			pendingAppendix.clear();
		},
		handleLine(line) {
			let parsed: PluginInboundToCoreMessage;
			try {
				parsed = JSON.parse(line) as PluginInboundToCoreMessage;
			} catch {
				daemonLog("warn", "inbound", "plugin_inbound_parse_error", {
					line: line.slice(0, 200),
				});
				return;
			}

			if (parsed.type === "ready") {
				if (!readySeen) {
					readySeen = true;
					params.onReady();
				}
				return;
			}

			if (parsed.type === "event") {
				params.onEvent(toInboundChatEvent(parsed.event));
				return;
			}

			if (parsed.type === "personaAppendix") {
				const pending = pendingAppendix.get(parsed.requestId);
				if (pending) {
					pendingAppendix.delete(parsed.requestId);
					pending.resolve(parsed.text);
				}
				return;
			}

			if (parsed.type === "error") {
				if (!readySeen) {
					params.onStartError(parsed.message);
				} else {
					daemonLog("error", "inbound", "plugin_inbound_error", {
						message: parsed.message,
					});
				}
			}
		},
	};
}

function createInboundBridge(
	child: ChildProcessWithoutNullStreams,
	dispatcher: ReturnType<typeof createStdoutDispatcher>,
): InboundBridge {
	let alive = true;

	child.on("exit", () => {
		alive = false;
		dispatcher.clearAppendixWaiters("Plugin inbound process exited");
	});

	const writeLine = (message: PluginInboundFromCoreMessage): void => {
		if (!alive) return;
		child.stdin.write(`${JSON.stringify(message)}\n`);
	};

	return {
		write: writeLine,
		isAlive: () => alive,
		dispose() {
			alive = false;
		},
		requestPersonaAppendix(conversation) {
			const requestId = randomUUID();
			return new Promise<string>((resolve, reject) => {
				const timer = setTimeout(() => {
					reject(new Error("Plugin persona appendix request timed out"));
				}, INBOUND_RPC_TIMEOUT_MS);
				dispatcher.registerAppendixWaiter(
					requestId,
					(text) => {
						clearTimeout(timer);
						resolve(text);
					},
					(err) => {
						clearTimeout(timer);
						reject(err);
					},
				);
				writeLine({ type: "getPersonaAppendix", requestId, conversation });
			});
		},
	};
}

function createPluginStatusReporter(
	bridge: InboundBridge,
	conversation: InboundConversation,
	dryRun: boolean,
): InboundStatusReporter {
	if (dryRun) {
		return { update() {}, async clear() {} };
	}
	return {
		update(line: string) {
			if (!line.trim()) return;
			bridge.write({ type: "statusUpdate", conversation, line });
		},
		async clear() {
			bridge.write({ type: "statusClear", conversation });
		},
	};
}

export function createPluginChatInboundProvider(params: {
	readonly target: PluginInvocationTarget;
	readonly integrationName: string;
	readonly buildEnvelope: () => {
		readonly config: Record<string, unknown>;
		readonly state: Record<string, unknown>;
	};
}): ChatInboundProvider {
	let bridge: InboundBridge | null = null;
	let child: ChildProcessWithoutNullStreams | null = null;
	let rl: readline.Interface | null = null;
	let dispatcher: ReturnType<typeof createStdoutDispatcher> | null = null;

	return {
		async start(ctx) {
			const spawnCommand =
				params.target.kind === "binary"
					? {
							command: params.target.executablePath,
							args: ["inbound", "run"],
							cwd: undefined as string | undefined,
						}
					: {
							command: params.target.bunPath,
							args: ["run", params.target.entryPath, "inbound", "run"],
							cwd: params.target.cwd,
						};

			child = spawn(spawnCommand.command, spawnCommand.args, {
				stdio: ["pipe", "pipe", "pipe"],
				...(spawnCommand.cwd ? { cwd: spawnCommand.cwd } : {}),
			});

			child.stderr.on("data", (chunk: Buffer) => {
				const text = chunk.toString("utf8").trim();
				if (text) {
					daemonLog("debug", "inbound", "plugin_inbound_stderr", {
						integration: params.integrationName,
						text: text.slice(0, 500),
					});
				}
			});

			let readyResolve: (() => void) | undefined;
			const readyPromise = new Promise<void>((resolve) => {
				readyResolve = resolve;
			});

			const startTimer = setTimeout(() => {
				daemonLog("warn", "inbound", "plugin_inbound_start_timeout", {
					integration: params.integrationName,
					timeoutMs: INBOUND_START_TIMEOUT_MS,
				});
				readyResolve?.();
			}, INBOUND_START_TIMEOUT_MS);

			dispatcher = createStdoutDispatcher({
				onEvent: ctx.emit,
				onReady: () => {
					clearTimeout(startTimer);
					readyResolve?.();
				},
				onStartError: (message) => {
					clearTimeout(startTimer);
					readyResolve?.();
					daemonLog("error", "inbound", "plugin_inbound_start_error", {
						integration: params.integrationName,
						message,
					});
				},
			});

			rl = readline.createInterface({ input: child.stdout });
			rl.on("line", (line) => dispatcher?.handleLine(line));

			child.on("exit", (code) => {
				clearTimeout(startTimer);
				if (code !== 0 && code !== null) {
					daemonLog("warn", "inbound", "plugin_inbound_exited", {
						integration: params.integrationName,
						code,
					});
				}
			});

			daemonLog("info", "inbound", "plugin_inbound_starting", {
				integration: params.integrationName,
			});

			const envelope = params.buildEnvelope();
			const externalSessions: readonly PluginExternalSessionSnapshot[] =
				listExternalSessionsForIntegration(params.integrationName).map(
					(record) => ({
						externalKey: record.externalKey,
						sessionId: record.sessionId,
						displayName: record.displayName,
						metadata: record.metadata,
						awaitingAskUser: record.awaitingAskUser,
						lastProcessedMessageId: record.lastProcessedMessageId,
					}),
				);
			child.stdin.write(
				`${JSON.stringify({
					type: "start",
					config: envelope.config,
					state: envelope.state,
					dryRun: ctx.dryRun,
					externalSessions,
				} satisfies PluginInboundFromCoreMessage)}\n`,
			);

			// Create the bridge immediately so deliverReply/createStatusReporter
			// work even if the plugin's `ready` signal is delayed beyond the timeout.
			// Slack Socket Mode's app.start() can take longer than 60s to resolve.
			bridge = createInboundBridge(child, dispatcher);

			await readyPromise;

			daemonLog("info", "inbound", "plugin_inbound_connected", {
				integration: params.integrationName,
			});

			ctx.signal.addEventListener(
				"abort",
				() => {
					bridge?.write({ type: "shutdown" });
					child?.kill();
				},
				{ once: true },
			);

			return () => {
				bridge?.write({ type: "shutdown" });
				child?.kill();
				rl?.close();
				bridge?.dispose();
				bridge = null;
				child = null;
				dispatcher = null;
				rl = null;
			};
		},

		async buildInboundPersonaAppendix(conversation) {
			if (!bridge?.isAlive()) return "";
			try {
				return await bridge.requestPersonaAppendix(conversation);
			} catch {
				return "";
			}
		},

		formatInboundStatusLine(event: ChatEvent) {
			return formatSlackInboundStatusMrkdwn(event);
		},

		createStatusReporter({ conversation, dryRun }) {
			if (!bridge) {
				return { update() {}, async clear() {} };
			}
			return createPluginStatusReporter(bridge, conversation, dryRun);
		},

		async deliverReply({ conversation, text, dryRun }) {
			bridge?.write({
				type: "deliverReply",
				conversation,
				text,
				dryRun,
			});
		},

		async deliverAskUser({ conversation, question, options, dryRun }) {
			bridge?.write({
				type: "deliverAskUser",
				conversation,
				question,
				options,
				dryRun,
			});
		},

		matchesAskUserReply(event, _pending: PendingAskUser) {
			return !event.isNewConversationTurn;
		},
	};
}
