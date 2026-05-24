import { randomUUID } from "node:crypto";
import type { LanguageModelUsage } from "ai";
import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import React, {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { AskUserHandler, AskUserToolResult } from "../../ai/ask-user-tool";
import {
	extractTokenUsageReport,
	formatCacheDebugMeta,
} from "../../ai/caching";
import type { CoreMessage } from "../../ai/chat";
import { formatPersonaAiLabel } from "../../ai/model-factory";
import {
	type UserIntentSpec,
	shouldPretreat,
	wrapUserPromptWithPretreatment,
} from "../../ai/pretreatment";
import type { ChatEvent } from "../../chat-pipeline/chat-events";
import {
	isIntegrationUsableInChat,
	modulesEqual,
	sortModulesByName,
} from "../../commands/chat-integrations";
import {
	type Persona,
	getDefaultPersonaName,
	getDefaultProvider,
	readConfig,
} from "../../config/index";
import {
	getIntegrationModules,
	getModulesForCategory,
	getModulesWithCapability,
} from "../../integrations/index";
import {
	ALL_PROVIDER_CATEGORIES,
	PROVIDER_CATEGORY_LABELS,
} from "../../integrations/types";
import type { IntegrationModule } from "../../integrations/types";
import {
	createChatEventLogSink,
	log,
	logTurnSummary,
} from "../../logging/chat-log";
import { listPersonas, resolvePersona } from "../../personas/index";
import {
	type Plan,
	cancelPlan,
	createPlan,
	executePlan,
	generatePlan,
	loadPlanBySession,
	shouldGeneratePlan,
	skipPhase,
} from "../../planning/index";
import { isDaemonRunning } from "../../schedules/daemon-status";
import { loadLocalSkills } from "../../skills/index";
import type { LaunchContext } from "../../toby-launch-context";
import { ConfigureApp } from "../configure/App";
import {
	createConfigureSession,
	refreshConfigureSessionTree,
} from "../configure/session";
import { SchedulesApp } from "../schedules/App";
import { SelectableTextRow, ViewModal } from "../shared";
import { SkillsApp } from "../skills/App";
import { applyChatEvent } from "./chat-event-reducer";
import { AppHeader } from "./components/app-header";
import { AskUserModal } from "./components/ask-user-modal";
import { ChatHelpScreen } from "./components/chat-help-screen";
import { ChatInputDock } from "./components/chat-input-dock";
import { ChatKeyboardShortcutsScreen } from "./components/chat-keyboard-shortcuts-screen";
import {
	IntegrationMultiPickerModal,
	buildIntegrationPickerRows,
} from "./components/integration-multi-picker-modal";
import { PlanStatusBar } from "./components/plan-status-bar";
import { buildTranscriptNodes } from "./components/transcript";
import {
	collectModulesForConnectionProbe,
	runConnectionProbes,
} from "./connection-probe";
import { ACCENT, TIPS } from "./constants";
import { formatToolStatusLine } from "./format-tool-status";
import { activityLineForChatEvent } from "./pipeline-footer";
import {
	injectSkillBodiesIntoFirstSystemMessage,
	prepareChatSessionMessages,
	replaceSessionSystemMessageForPersona,
} from "./prepare-messages";
import { appendPromptHistory, loadPromptHistory } from "./prompt-history";
import { runIntegrationChatTurn } from "./run-turn";
import {
	CHAT_SESSION_PICKER_LIMIT,
	appendMessageBatch,
	appendTranscriptBatch,
	createChatSession,
	listChatSessions,
	loadChatSession,
	renameChatSession,
} from "./session-store";
import { buildSkillDebugTranscriptEntries } from "./skill-debug";
import {
	SLASH_COMMANDS,
	getNearestSlashCommand,
	getSlashSuggestions,
	resolveSlashSubmission,
} from "./slash-commands";
import type { UpgradeUiStatus } from "./slash-commands/types";
import { getToolDisplayLabel } from "./tool-labels";
import { flattenTranscript } from "./transcript-layout";
import type { AskModal, DisplayRow, TranscriptEntry } from "./types";
import { useUpdateCheck } from "./use-update-check";
import { yieldToRenderer } from "./yield-to-renderer";

type TurnResult = {
	readonly text: string;
	readonly responseMessages: readonly CoreMessage[];
};

interface ChatSessionAppProps {
	readonly initialModules: readonly IntegrationModule[];
	readonly persona: Persona;
	readonly dryRun: boolean;
	readonly debug: boolean;
	readonly initialUserPrompt: string;
	readonly launchContext: LaunchContext;
}

interface MultiPickerState {
	readonly modules: readonly IntegrationModule[];
	readonly selectedNames: readonly string[];
	readonly cursorIndex: number;
}

interface SessionPickerState {
	readonly sessions: readonly { id: string; name: string }[];
	readonly cursorIndex: number;
}

type PersonaPickerRow =
	| { readonly kind: "add" }
	| { readonly kind: "persona"; readonly persona: Persona };

interface PersonaPickerState {
	readonly rows: readonly PersonaPickerRow[];
	readonly cursorIndex: number;
}

const ACTIVITY_GLYPH_FRAMES = ["·", "•", "●", "•"] as const;

function isAbortError(e: unknown): boolean {
	if (e instanceof DOMException && e.name === "AbortError") return true;
	if (e instanceof Error) {
		if (e.name === "AbortError") return true;
		if (/abort/i.test(e.message)) return true;
	}
	return false;
}

function formatScopeLabel(modules: readonly IntegrationModule[]): string {
	if (modules.length === 0) {
		return "(none)";
	}
	const base = modules.map((m) => m.displayName).join(" + ");
	const defaultParts: string[] = [];
	for (const cat of ALL_PROVIDER_CATEGORIES) {
		const name = getDefaultProvider(cat);
		if (name && modules.some((m) => m.name === name)) {
			defaultParts.push(`${PROVIDER_CATEGORY_LABELS[cat]}=${name}`);
		}
	}
	if (defaultParts.length === 0) {
		return base;
	}
	return `${base} [defaults: ${defaultParts.join(", ")}]`;
}

function toggleNameInList(
	names: readonly string[],
	name: string,
	on: boolean,
): string[] {
	const set = new Set(names);
	if (on) {
		set.add(name);
	} else {
		set.delete(name);
	}
	return [...set].sort((a, b) => a.localeCompare(b));
}

function suggestSessionNameFromTranscript(
	entries: readonly TranscriptEntry[],
): string | null {
	const firstUser = entries.find((e) => e.kind === "user");
	if (!firstUser || !firstUser.text.trim()) {
		return null;
	}
	const raw = firstUser.text
		.trim()
		.replace(/\s+/g, " ")
		.replace(/[“”]/g, '"')
		.replace(/[‘’]/g, "'");
	const words = raw.split(" ").filter(Boolean);
	if (words.length === 0) {
		return null;
	}
	const picked = words.slice(0, 8).join(" ");
	const clipped = picked.length > 60 ? `${picked.slice(0, 57)}…` : picked;
	return clipped;
}

function transcriptMetaForAttachedSkills(
	names: readonly string[],
): TranscriptEntry[] {
	const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
	return unique.map((name) => ({ kind: "meta", text: `Skill: ${name}` }));
}

function createBootPrepTranscript(lifecycleId: string): TranscriptEntry[] {
	return [
		{
			kind: "boxed_step",
			id: lifecycleId,
			seq: 1,
			variant: "lifecycle",
			header: "Preparing Session…",
			body: "Starting session preparation…",
		},
	];
}

export function ChatSessionApp({
	initialModules,
	persona,
	dryRun,
	debug,
	initialUserPrompt,
	launchContext,
}: ChatSessionAppProps) {
	const { exit } = useApp();
	const { columns } = useWindowSize();
	const termCols = Math.max(24, columns - 2);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [sessionName, setSessionName] = useState<string>("New chat");
	const [sessionBootMode, setSessionBootMode] = useState<"new" | "loaded">(
		"new",
	);
	const [messages, setMessages] = useState<CoreMessage[] | null>(null);
	const bootLifecycleIdRef = useRef(randomUUID());
	const [transcript, setTranscript] = useState<TranscriptEntry[]>(() => {
		const boot = createBootPrepTranscript(bootLifecycleIdRef.current);
		if (initialUserPrompt.trim()) {
			return [{ kind: "user", text: initialUserPrompt }, ...boot];
		}
		return boot;
	});
	const [input, setInput] = useState("");
	const [inputCursorResetToken, setInputCursorResetToken] = useState(0);
	const [recentPrompts, setRecentPrompts] = useState(() => loadPromptHistory());
	const [loading, setLoading] = useState(false);
	const [activityLine, setActivityLine] = useState("Thinking…");
	const [streamingAssistant, setStreamingAssistant] = useState("");
	const [streamingAssistantHeader, setStreamingAssistantHeader] = useState(
		persona.name,
	);
	const [lastUsage, setLastUsage] = useState<LanguageModelUsage | null>(null);
	const [bootError, setBootError] = useState<string | null>(null);
	const [bootActivityLine, setBootActivityLine] =
		useState("Preparing session…");
	const [connectionProbeLine, setConnectionProbeLine] = useState("");
	const [askModal, setAskModal] = useState<AskModal | null>(null);
	const [askSelected, setAskSelected] = useState(0);
	const [showHelp, setShowHelp] = useState(false);
	const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
	const updateAvailable = useUpdateCheck({ enabled: !dryRun });
	const [upgradeUiStatus, setUpgradeUiStatus] = useState<UpgradeUiStatus>({
		status: "idle",
	});
	const [showConfig, setShowConfig] = useState(false);
	const [showSkills, setShowSkills] = useState(false);
	const [showSchedules, setShowSchedules] = useState(false);
	const [daemonRunning, setDaemonRunning] = useState(
		() => isDaemonRunning().running,
	);
	const [configureSession, setConfigureSession] = useState(() =>
		createConfigureSession(),
	);
	const [selectedModules, setSelectedModules] = useState<IntegrationModule[]>(
		() => sortModulesByName(initialModules),
	);
	const [connectedByIntegration, setConnectedByIntegration] = useState<
		Record<string, boolean | null>
	>(() => ({}));
	const [slashCursorIndex, setSlashCursorIndex] = useState(0);
	const [sessionPrompt, setSessionPrompt] = useState(initialUserPrompt);
	const [multiPicker, setMultiPicker] = useState<MultiPickerState | null>(null);
	const [sessionPicker, setSessionPicker] = useState<SessionPickerState | null>(
		null,
	);
	const [personaPicker, setPersonaPicker] = useState<PersonaPickerState | null>(
		null,
	);
	const [activePersona, setActivePersona] = useState(() => persona);
	const activePersonaRef = useRef(activePersona);
	const [activePlan, setActivePlan] = useState<Plan | null>(null);
	const activePlanRef = useRef<Plan | null>(null);
	const [configureInitialPath, setConfigureInitialPath] = useState<
		readonly string[] | undefined
	>(undefined);
	const [configureEditorItemKey, setConfigureEditorItemKey] = useState<
		string | undefined
	>(undefined);
	const [configureMountKey, setConfigureMountKey] = useState(0);
	const [activityGlyphFrame, setActivityGlyphFrame] = useState(0);
	const didAutoRunFirstTurnRef = useRef(false);
	const assistantStreamBufRef = useRef("");
	const assistantSegmentHeaderRef = useRef(persona.name);
	const transcriptLocalSeqRef = useRef(1);
	const assistantSegmentCommittedRef = useRef(false);
	const askSelectedRef = useRef(0);
	const selectedModulesRef = useRef(selectedModules);
	const pendingScopeChangeNoteRef = useRef<string | null>(null);
	const didNameSessionRef = useRef(false);
	const lastSavedMessageCountRef = useRef(0);
	const lastSavedTranscriptCountRef = useRef(0);
	const sessionIdRef = useRef<string | null>(null);
	const transcriptRef = useRef(transcript);
	const ongoingPretreatAbortRef = useRef<AbortController | null>(null);
	const pendingSteeringPromptRef = useRef<string | null>(null);
	const snapRef = useRef({
		askModal: null as AskModal | null,
		messages: null as CoreMessage[] | null,
		loading: false,
		showHelp: false,
		showKeyboardShortcuts: false,
		multiPicker: null as MultiPickerState | null,
		sessionPicker: null as SessionPickerState | null,
		personaPicker: null as PersonaPickerState | null,
	});

	const allDisplayRows = useMemo((): DisplayRow[] => {
		if (messages === null && transcript.length === 0) {
			return [];
		}
		return flattenTranscript(
			transcript,
			streamingAssistant,
			messages === null || loading,
			termCols,
			streamingAssistantHeader,
			debug,
		);
	}, [
		messages,
		transcript,
		streamingAssistant,
		streamingAssistantHeader,
		loading,
		termCols,
		debug,
	]);

	const tip = useMemo(() => TIPS[Math.floor(Math.random() * TIPS.length)], []);

	const chatIntegrations = useMemo(
		() => getModulesWithCapability("chat").filter((m) => m.chat),
		[],
	);

	const moduleNames = useMemo(
		() => selectedModules.map((m) => m.name),
		[selectedModules],
	);

	useEffect(() => {
		// Defer probes until session boot finishes so startup context can render first.
		if (messages === null) {
			setConnectionProbeLine("");
			return;
		}
		let cancelled = false;
		const modulesToProbe = collectModulesForConnectionProbe(selectedModules);
		if (modulesToProbe.length === 0) {
			setConnectionProbeLine("");
			return;
		}
		const pending = new Set(modulesToProbe.map((m) => m.name));
		setConnectedByIntegration((prev) => {
			const next: Record<string, boolean | null> = { ...prev };
			for (const m of modulesToProbe) {
				next[m.name] = null;
			}
			return next;
		});
		setConnectionProbeLine(
			`Checking ${modulesToProbe.length} integration connection${
				modulesToProbe.length === 1 ? "" : "s"
			}…`,
		);
		void (async () => {
			await runConnectionProbes(modulesToProbe, {
				onProgress: async (event) => {
					if (cancelled) {
						return;
					}
					if (event.type === "start") {
						setConnectionProbeLine(
							`Checking ${event.module.displayName} connection…`,
						);
					} else if (event.type === "result") {
						pending.delete(event.module.name);
						setConnectedByIntegration((prev) => ({
							...prev,
							[event.module.name]: event.result.ok,
						}));
						const status = event.result.ok ? "ready" : "unavailable";
						const suffix =
							pending.size > 0
								? ` Checking ${pending.size} more…`
								: " Connection checks complete.";
						setConnectionProbeLine(
							`${event.module.displayName} connection ${status}.${suffix}`,
						);
					} else {
						setConnectionProbeLine("");
					}
					await yieldToRenderer();
				},
			});
			if (!cancelled) {
				setConnectionProbeLine("");
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [selectedModules, messages]);

	const pickerRows = useMemo(
		() => (multiPicker ? buildIntegrationPickerRows(multiPicker.modules) : []),
		[multiPicker],
	);

	const selectedNameSet = useMemo(
		() => new Set(multiPicker?.selectedNames ?? []),
		[multiPicker?.selectedNames],
	);

	const slashSuggestions = useMemo(() => getSlashSuggestions(input), [input]);

	useEffect(() => {
		setSlashCursorIndex((prev) => {
			if (slashSuggestions.length === 0) {
				return 0;
			}
			return Math.min(prev, slashSuggestions.length - 1);
		});
	}, [slashSuggestions]);

	const selectedSlashCommand =
		slashSuggestions.length > 0
			? (slashSuggestions[slashCursorIndex] ?? slashSuggestions[0] ?? null)
			: null;

	useLayoutEffect(() => {
		selectedModulesRef.current = selectedModules;
	}, [selectedModules]);

	useLayoutEffect(() => {
		sessionIdRef.current = sessionId;
	}, [sessionId]);

	useLayoutEffect(() => {
		transcriptRef.current = transcript;
	}, [transcript]);

	useEffect(() => {
		return () => {
			ongoingPretreatAbortRef.current?.abort();
		};
	}, []);

	// Poll daemon status every 10 seconds
	useEffect(() => {
		const timer = setInterval(() => {
			setDaemonRunning(isDaemonRunning().running);
		}, 10_000);
		return () => clearInterval(timer);
	}, []);

	useEffect(() => {
		const shouldAnimate = messages === null || loading;
		if (!shouldAnimate) {
			setActivityGlyphFrame(0);
			return;
		}
		const timer = setInterval(() => {
			setActivityGlyphFrame(
				(prev) => (prev + 1) % ACTIVITY_GLYPH_FRAMES.length,
			);
		}, 120);
		return () => clearInterval(timer);
	}, [messages, loading]);

	useLayoutEffect(() => {
		activePersonaRef.current = activePersona;
	}, [activePersona]);

	useLayoutEffect(() => {
		activePlanRef.current = activePlan;
	}, [activePlan]);

	useLayoutEffect(() => {
		askSelectedRef.current = askSelected;
		snapRef.current = {
			askModal,
			messages,
			loading,
			showHelp,
			showKeyboardShortcuts,
			multiPicker,
			sessionPicker,
			personaPicker,
		};
	}, [
		askModal,
		askSelected,
		loading,
		messages,
		showHelp,
		showKeyboardShortcuts,
		multiPicker,
		sessionPicker,
		personaPicker,
	]);

	const startFreshSession = useCallback(
		(params?: { readonly prompt?: string; readonly note?: string }) => {
			setSessionId(null);
			setSessionName("New chat");
			setSessionBootMode("new");
			didNameSessionRef.current = false;
			lastSavedMessageCountRef.current = 0;
			lastSavedTranscriptCountRef.current = 0;
			bootLifecycleIdRef.current = randomUUID();
			transcriptLocalSeqRef.current = 1;
			setBootError(null);
			setBootActivityLine("Preparing session…");
			setSessionPrompt(params?.prompt ?? "");
			didAutoRunFirstTurnRef.current = false;
			setMessages(null);
			setActivePlan(null);
			const bootPrep = createBootPrepTranscript(bootLifecycleIdRef.current);
			setTranscript(
				params?.note
					? [{ kind: "meta", text: params.note }, ...bootPrep]
					: bootPrep,
			);
			log("info", "session", "session_create", { note: params?.note });
		},
		[],
	);

	const askUserHandler = useCallback<AskUserHandler>(
		async ({ query, options }) =>
			new Promise<AskUserToolResult>((resolve) => {
				setAskModal({ query, options, resolve });
				setAskSelected(0);
			}),
		[],
	);

	const runModelTurn = useCallback(
		async (
			msgs: CoreMessage[],
			overrideSessionId?: string,
		): Promise<TurnResult> => {
			const sid = overrideSessionId ?? sessionIdRef.current;
			if (!sid) {
				throw new Error("Internal error: missing session id");
			}
			setLoading(true);
			setStreamingAssistant("");
			setStreamingAssistantHeader(activePersona.name);
			assistantSegmentHeaderRef.current = activePersona.name;
			assistantStreamBufRef.current = "";
			assistantSegmentCommittedRef.current = false;
			const turnAbort = new AbortController();
			ongoingPretreatAbortRef.current = turnAbort;
			let activeToolCalls = 0;
			const turnStartMs = Date.now();
			const eventLogSink = createChatEventLogSink(sid);
			const nextLocalSeq = () => {
				transcriptLocalSeqRef.current += 1;
				return transcriptLocalSeqRef.current;
			};
			const emitChatEvent = (ev: ChatEvent) => {
				eventLogSink(ev);
				const footerHint = activityLineForChatEvent(ev);
				if (footerHint !== null) {
					setActivityLine(footerHint);
				}
				if (ev.type === "assistant_segment_start") {
					assistantSegmentHeaderRef.current = ev.header;
					assistantStreamBufRef.current = "";
					return;
				}
				if (ev.type === "assistant_text_delta") {
					assistantStreamBufRef.current += ev.delta;
					setStreamingAssistant(assistantStreamBufRef.current);
					setStreamingAssistantHeader(assistantSegmentHeaderRef.current);
					return;
				}
				if (ev.type === "assistant_segment_end") {
					const body = assistantStreamBufRef.current.trim();
					assistantStreamBufRef.current = "";
					setStreamingAssistant("");
					if (body.length > 0) {
						assistantSegmentCommittedRef.current = true;
						setTranscript((t) => [
							...t,
							{
								kind: "boxed_step",
								id: ev.id,
								seq: nextLocalSeq(),
								variant: "assistant",
								header: assistantSegmentHeaderRef.current,
								body,
							},
						]);
					}
					return;
				}
				setTranscript((t) => applyChatEvent(t, ev));
			};
			let responseMessages: CoreMessage[] = [];
			let responseText = "";
			try {
				const out = await runIntegrationChatTurn(moduleNames, msgs, {
					persona: activePersona,
					dryRun,
					askUser: askUserHandler,
					chatWithToolsOptions: {
						onChatEvent: emitChatEvent,
						abortSignal: turnAbort.signal,
						onToolCallStart: ({ toolName }) => {
							activeToolCalls += 1;
							setActivityLine(formatToolStatusLine(toolName));
						},
						onToolCallComplete: () => {
							activeToolCalls = Math.max(0, activeToolCalls - 1);
							if (activeToolCalls === 0) {
								setActivityLine("Thinking…");
							}
						},
					},
				});
				const next = [...msgs, ...out.responseMessages];
				setMessages(next);
				setLastUsage(out.usage ?? null);
				responseMessages = out.responseMessages;
				responseText = out.text ?? "";

				const tokenReport = extractTokenUsageReport(out.usage, {
					persona: activePersonaRef.current,
					moduleNames: moduleNames,
				});
				logTurnSummary(sid, undefined, {
					turnIndex: undefined,
					durationMs: Date.now() - turnStartMs,
					toolCallCount: out.toolCalls.length,
					toolsUsed: out.toolCalls.map((tc) => tc.name),
					cacheHits: 0,
					cacheMisses: 0,
					inputTokens: tokenReport?.inputTokens,
					outputTokens: tokenReport?.outputTokens,
					cacheReadTokens: tokenReport?.cacheReadTokens,
					cacheWriteTokens: tokenReport?.cacheWriteTokens,
					errorCount: 0,
				});

				const reply = out.text?.trim() || "";

				const additions: TranscriptEntry[] = [];
				if (reply.length > 0 && !assistantSegmentCommittedRef.current) {
					additions.push({
						kind: "boxed_step",
						id: randomUUID(),
						seq: nextLocalSeq(),
						variant: "assistant",
						header: activePersonaRef.current.name,
						body: reply,
					});
				}
				if (process.env.TOBY_DEBUG_CACHE === "1" && tokenReport) {
					const cacheMeta = formatCacheDebugMeta(tokenReport);
					if (cacheMeta) {
						additions.push({
							kind: "meta",
							text: `Usage: ${cacheMeta}`,
						});
					}
					const rawUsage = out.usage?.raw;
					if (rawUsage && typeof rawUsage === "object") {
						additions.push({
							kind: "meta",
							text: `Usage raw: ${JSON.stringify(rawUsage)}`,
						});
					}
					if (out.providerMetadata) {
						additions.push({
							kind: "meta",
							text: `Provider metadata: ${JSON.stringify(out.providerMetadata)}`,
						});
					}
				}
				// Avoid duplicating what the assistant already summarized.
				// If the model produced no text (tool-only turn), we still show actions.
				if (reply.length === 0) {
					for (const a of out.appliedActions) {
						additions.push({ kind: "meta", text: `+ ${a}` });
					}
				}
				setStreamingAssistant("");
				setTranscript((t) => {
					const persistId = randomUUID();
					let nt = [...t, ...additions];
					nt = applyChatEvent(nt, {
						type: "lifecycle_start",
						id: persistId,
						seq: nextLocalSeq(),
						header: "Saving session…",
					});
					nt = applyChatEvent(nt, {
						type: "lifecycle_end",
						id: persistId,
						seq: nextLocalSeq(),
						detail: "Session data queued to save.",
					});
					return nt;
				});
			} catch (e) {
				const partial = assistantStreamBufRef.current.trim();
				assistantStreamBufRef.current = "";
				setStreamingAssistant("");
				if (partial.length > 0) {
					transcriptLocalSeqRef.current += 1;
					setTranscript((t) => [
						...t,
						{
							kind: "boxed_step",
							id: randomUUID(),
							seq: transcriptLocalSeqRef.current,
							variant: "assistant",
							header: assistantSegmentHeaderRef.current,
							body: partial,
						},
					]);
				}
				if (isAbortError(e)) {
					const steering = pendingSteeringPromptRef.current;
					const metaText = steering ? "Redirecting..." : "Turn cancelled.";
					setTranscript((t) => [...t, { kind: "meta", text: metaText }]);
					log("info", "turn", "turn_aborted", { steering: Boolean(steering) });
					return {
						text: partial,
						responseMessages: [],
					};
				}
				const msg = e instanceof Error ? e.message : String(e);
				setTranscript((t) => [...t, { kind: "error", text: msg }]);
				log("error", "turn", "turn_error", { message: msg });
				throw e;
			} finally {
				setLoading(false);
			}
			return { text: responseText, responseMessages };
		},
		[moduleNames, askUserHandler, dryRun, activePersona],
	);

	useEffect(() => {
		let cancelled = false;
		const ac = new AbortController();
		ongoingPretreatAbortRef.current = ac;
		void (async () => {
			try {
				const sid = sessionId;
				if (messages !== null) {
					return;
				}
				// If we loaded an existing session, don't overwrite its transcript/messages
				// by re-running the boot preparation effect.
				if (sessionBootMode === "loaded") {
					return;
				}
				const bootSeq = () => {
					transcriptLocalSeqRef.current += 1;
					return transcriptLocalSeqRef.current;
				};
				const bootCtxLifecycleId = bootLifecycleIdRef.current;
				let bootTranscript: TranscriptEntry[] = [...transcriptRef.current];
				if (sessionPrompt.trim()) {
					const hasUser = bootTranscript.some((e) => e.kind === "user");
					if (!hasUser) {
						bootTranscript = [
							{ kind: "user", text: sessionPrompt },
							...bootTranscript,
						];
					}
				}
				const publishBootTranscript = () => {
					if (!cancelled) {
						setTranscript([...bootTranscript]);
					}
				};
				const emitBoot = async (event: ChatEvent) => {
					if (cancelled) {
						return;
					}
					bootTranscript = applyChatEvent(bootTranscript, event);
					const footerHint = activityLineForChatEvent(event);
					if (footerHint) {
						setBootActivityLine(footerHint);
					}
					publishBootTranscript();
					await yieldToRenderer();
				};
				const emitBootStatus = async (line: string) => {
					await emitBoot({
						type: "lifecycle_set",
						id: bootCtxLifecycleId,
						seq: bootSeq(),
						line,
					});
				};
				setBootActivityLine("Preparing Session…");
				publishBootTranscript();
				await yieldToRenderer();
				await emitBootStatus(`Scope: ${formatScopeLabel(selectedModules)}`);
				await emitBootStatus(`Persona: ${activePersona.name}`);
				await emitBootStatus("Loading local skills catalog…");
				const localSkills = loadLocalSkills();
				await emitBootStatus(
					`Local skills catalog: ${localSkills.length} available.`,
				);
				let effectivePrompt = sessionPrompt;
				let prepId: string | null = null;
				if (sessionPrompt.trim() && shouldPretreat([], sessionPrompt, true)) {
					prepId = randomUUID();
				}
				let prepSpec: UserIntentSpec | null = null;
				if (sessionPrompt.trim()) {
					if (prepId) {
						await emitBoot({
							type: "prep_start",
							id: prepId,
							seq: bootSeq(),
							header: "Prompt preparation",
						});
						await emitBootStatus(
							"Analyzing your request for intent and relevant skills…",
						);
					}
					const wrapResult = await wrapUserPromptWithPretreatment({
						priorMessages: [],
						rawUserText: sessionPrompt,
						integrationLabels: formatScopeLabel(selectedModules),
						isFirstTurn: true,
						persona: activePersona,
						skillsCatalog: localSkills,
						abortSignal: ac.signal,
					});
					if (!cancelled) {
						effectivePrompt = wrapResult.content;
						prepSpec = wrapResult.spec;
					}
					if (prepId && !cancelled) {
						const detail =
							process.env.TOBY_DEBUG_PREP === "1" &&
							prepSpec &&
							effectivePrompt.trim() !== sessionPrompt.trim()
								? "Intent specification attached to the model message (debug)."
								: effectivePrompt.trim() !== sessionPrompt.trim()
									? "Intent specification attached to the model message."
									: "Request prepared.";
						await emitBoot({
							type: "prep_end",
							id: prepId,
							seq: bootSeq(),
							detail,
						});
					}
				}
				if (cancelled) {
					return;
				}
				await emitBootStatus("Fetching integration connection context…");
				let initial = await prepareChatSessionMessages(
					selectedModules,
					activePersona,
					effectivePrompt,
					emitBootStatus,
				);
				const attachedSkills = prepSpec?.relevantSkills ?? [];
				if (attachedSkills.length > 0) {
					await emitBootStatus(
						`Attaching skill instructions: ${attachedSkills.join(", ")}.`,
					);
				}
				initial = injectSkillBodiesIntoFirstSystemMessage(
					initial,
					attachedSkills,
					localSkills,
				);
				if (cancelled) {
					return;
				}
				await emitBootStatus("Session ready.");
				await yieldToRenderer();
				setMessages(initial);
				const note = pendingScopeChangeNoteRef.current;
				pendingScopeChangeNoteRef.current = null;
				const metaEntries: TranscriptEntry[] = note
					? [{ kind: "meta", text: note }]
					: [];
				const skillMeta = transcriptMetaForAttachedSkills(attachedSkills);
				const skillDebugMeta = buildSkillDebugTranscriptEntries({
					debug,
					available: localSkills,
					priorMessages: [],
					rawUserText: sessionPrompt,
					isFirstTurn: true,
					spec: prepSpec,
				});
				const nextTranscript = [
					...bootTranscript,
					...skillDebugMeta,
					...skillMeta,
					...metaEntries,
				];
				setTranscript(nextTranscript);
				await yieldToRenderer();

				// Persist boot state after the UI has painted (SQLite is sync).
				if (sid) {
					const persistSid = sid;
					const persistMessages = initial;
					const persistTranscript = nextTranscript;
					setImmediate(() => {
						if (cancelled) {
							return;
						}
						appendMessageBatch(persistSid, 0, persistMessages);
						lastSavedMessageCountRef.current = persistMessages.length;
						if (persistTranscript.length > 0) {
							appendTranscriptBatch(persistSid, 0, persistTranscript);
							lastSavedTranscriptCountRef.current = persistTranscript.length;
						}
					});
				}
			} catch (e) {
				if (!cancelled) {
					setBootError(e instanceof Error ? e.message : String(e));
				}
			}
		})();
		return () => {
			cancelled = true;
			ac.abort();
		};
	}, [
		selectedModules,
		activePersona,
		sessionPrompt,
		sessionId,
		sessionBootMode,
		messages,
		debug,
	]);

	// Incrementally persist new messages and transcript entries.
	useEffect(() => {
		const sid = sessionId;
		if (!sid || !messages) {
			return;
		}
		const prev = lastSavedMessageCountRef.current;
		if (messages.length > prev) {
			appendMessageBatch(sid, prev, messages.slice(prev));
			lastSavedMessageCountRef.current = messages.length;
		}
	}, [messages, sessionId]);

	useEffect(() => {
		const sid = sessionId;
		if (!sid) {
			return;
		}
		const prev = lastSavedTranscriptCountRef.current;
		if (transcript.length > prev) {
			appendTranscriptBatch(sid, prev, transcript.slice(prev));
			lastSavedTranscriptCountRef.current = transcript.length;
		}
	}, [transcript, sessionId]);

	// Name the session once we have a real exchange.
	useEffect(() => {
		const sid = sessionId;
		if (!sid) return;
		if (didNameSessionRef.current) return;
		const hasAssistant = transcript.some(
			(e) =>
				e.kind === "assistant" ||
				(e.kind === "boxed_step" && e.variant === "assistant"),
		);
		const suggested = suggestSessionNameFromTranscript(transcript);
		if (!hasAssistant || !suggested) return;
		renameChatSession(sid, suggested);
		setSessionName(suggested);
		didNameSessionRef.current = true;
		log("info", "session", "session_rename", { id: sid, name: suggested });
	}, [sessionId, transcript]);

	useEffect(() => {
		if (!messages || bootError) {
			return;
		}
		if (!sessionPrompt.trim()) {
			return;
		}
		if (didAutoRunFirstTurnRef.current) {
			return;
		}
		didAutoRunFirstTurnRef.current = true;

		let sid = sessionId;
		if (!sid) {
			const created = createChatSession({ name: "New chat" });
			sid = created.id;
			setSessionId(created.id);
			setSessionName(created.name);
			lastSavedMessageCountRef.current = 0;
			lastSavedTranscriptCountRef.current = 0;
		}
		const sidFinal = sid;

		void (async () => {
			// Check if explicit plan generation should run based on the
			// pretreatment spec that was already attached during boot preparation.
			// Implicit plans (2+ tool calls in a turn) are handled reactively
			// in runModelTurn's onToolCallStart/onToolCallComplete callbacks.
			let lastUserMsg: CoreMessage | undefined;
			for (let mi = messages.length - 1; mi >= 0; mi--) {
				const m = messages[mi];
				if (m.role === "user") {
					lastUserMsg = m;
					break;
				}
			}
			const userContent =
				typeof lastUserMsg?.content === "string" ? lastUserMsg.content : "";
			// Only attempt plan generation if the prompt looks multi-step.
			if (!shouldGeneratePlan(null, sessionPrompt)) {
				void runModelTurnRef.current(messages, sidFinal);
				return;
			}

			const planResult = await generatePlan(null, sessionPrompt, {
				abortSignal: ongoingPretreatAbortRef.current?.signal,
				persona: activePersonaRef.current,
			});

			if (!planResult || planResult.phases.length < 2) {
				// No plan needed, run a single turn
				void runModelTurnRef.current(messages, sidFinal);
				return;
			}

			// Create and execute the plan
			const plan = createPlan({
				sessionId: sidFinal,
				goal: planResult.goal,
				phases: planResult.phases,
			});
			setActivePlan(plan);
			activePlanRef.current = plan;

			// Add plan context to the first user message
			const planContextLines = [
				`[Plan created with ${plan.phases.length} phases]`,
				`Goal: ${plan.goal}`,
				"Phases:",
				...plan.phases.map(
					(p, i) => `  ${i + 1}. ${p.label}: ${p.description}`,
				),
				"Execute the plan phase by phase.",
			];
			const planContext = planContextLines.join("\n");
			const augmentedMessages = messages.map((m) => {
				if (m.role === "user" && m === lastUserMsg) {
					return {
						...m,
						content:
							typeof m.content === "string"
								? `${m.content}\n\n${planContext}`
								: m.content,
					};
				}
				return m;
			});
			setMessages(augmentedMessages);

			const nextLocalSeq = () => {
				transcriptLocalSeqRef.current += 1;
				return transcriptLocalSeqRef.current;
			};

			try {
				const resultPlan = await executePlan(plan, {
					sessionId: sidFinal,
					emitChatEvent: (ev: ChatEvent) => {
						const eventLogSink = createChatEventLogSink(sidFinal);
						eventLogSink(ev);
						const footerHint = activityLineForChatEvent(ev);
						if (footerHint !== null) {
							setActivityLine(footerHint);
						}
						if (
							ev.type === "plan_phase_start" ||
							ev.type === "plan_phase_end"
						) {
							setTranscript((t) => applyChatEvent(t, ev));
						}
						if (ev.type === "plan_created") {
							setTranscript((t) => applyChatEvent(t, ev));
						}
						if (ev.type === "plan_amended") {
							setTranscript((t) => applyChatEvent(t, ev));
						}
						if (ev.type === "plan_completed") {
							setTranscript((t) => applyChatEvent(t, ev));
						}
						// Refresh active plan state on phase transitions
						if (
							ev.type === "plan_phase_end" ||
							ev.type === "plan_amended" ||
							ev.type === "plan_completed"
						) {
							const refreshed = loadPlanBySession(sidFinal);
							if (refreshed) {
								setActivePlan(refreshed);
								activePlanRef.current = refreshed;
							}
						}
					},
					nextSeq: nextLocalSeq,
					runTurn: async (msgs, overrideSid) => {
						await runModelTurnRef.current(msgs, overrideSid);
						// After the turn, the messages state has been updated.
						// Return a minimal result since executePlan needs responseMessages
						// but the actual state update happens in runModelTurn.
						// We return empty since executePlan manages its own message flow
						// by calling runTurn which appends to the session history.
						return {
							text: "",
							responseMessages: [] as CoreMessage[],
						};
					},
					abortSignal: ongoingPretreatAbortRef.current?.signal,
				});

				setActivePlan(resultPlan);
				activePlanRef.current = resultPlan;
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				setTranscript((t) => [...t, { kind: "error", text: msg }]);
			}
		})();
	}, [bootError, messages, sessionPrompt, sessionId]);

	const runModelTurnRef = useRef(runModelTurn);
	runModelTurnRef.current = runModelTurn;

	// Process a pending steering prompt after an aborted turn finishes.
	useEffect(() => {
		if (loading) return;
		const steering = pendingSteeringPromptRef.current;
		if (!steering) return;
		pendingSteeringPromptRef.current = null;

		const msgs = snapRef.current.messages;
		if (!msgs) return;

		let sid = sessionIdRef.current;
		if (!sid) {
			const created = createChatSession({ name: "New chat" });
			sid = created.id;
			setSessionId(created.id);
			setSessionName(created.name);
			lastSavedMessageCountRef.current = 0;
			lastSavedTranscriptCountRef.current = 0;
		}
		const sidFinal = sid;

		void (async () => {
			const ac = new AbortController();
			ongoingPretreatAbortRef.current = ac;
			const msgsBefore = snapRef.current.messages;
			if (!msgsBefore) return;

			const isFirstTurn = !transcriptRef.current.some((e) => e.kind === "user");
			const willPretreat = shouldPretreat(msgsBefore, steering, isFirstTurn);
			setLoading(true);
			setActivityLine(willPretreat ? "Preparing request..." : "Thinking...");

			const localSkills = loadLocalSkills();
			const { content, spec } = await wrapUserPromptWithPretreatment({
				priorMessages: msgsBefore,
				rawUserText: steering,
				integrationLabels: formatScopeLabel(selectedModulesRef.current),
				isFirstTurn,
				persona: activePersonaRef.current,
				skillsCatalog: localSkills,
				abortSignal: ac.signal,
			});

			const msgsAfter = snapRef.current.messages;
			if (!msgsAfter) {
				setLoading(false);
				return;
			}

			const userMsg: CoreMessage = { role: "user", content };
			let next = [...msgsAfter, userMsg];
			next = injectSkillBodiesIntoFirstSystemMessage(
				next,
				spec?.relevantSkills ?? [],
				localSkills,
			);
			setMessages(next);

			const skillMeta = transcriptMetaForAttachedSkills(
				spec?.relevantSkills ?? [],
			);
			if (skillMeta.length > 0) {
				setTranscript((t) => [...t, ...skillMeta]);
			}

			await runModelTurnRef.current(next, sidFinal);
		})();
	}, [loading]);

	const openIntegrationPicker = useCallback(async () => {
		const usable: IntegrationModule[] = [];
		for (const m of chatIntegrations) {
			if (await isIntegrationUsableInChat(m)) {
				usable.push(m);
			}
		}
		if (usable.length === 0) {
			setTranscript((t) => [
				...t,
				{
					kind: "meta",
					text: "No chat integrations ready to choose from (connect Gmail, add a Todoist API key, configure Slack, or configure Azure AD credentials).",
				},
			]);
			return;
		}
		const sorted = sortModulesByName(usable);
		const current = selectedModulesRef.current;
		const selectedNames = current.map((m) => m.name);
		setMultiPicker({
			modules: sorted,
			selectedNames,
			cursorIndex: 0,
		});
	}, [chatIntegrations]);

	const openSessionsPicker = useCallback(() => {
		const sessions = listChatSessions(CHAT_SESSION_PICKER_LIMIT).map((s) => ({
			id: s.id,
			name: s.name,
		}));
		if (sessions.length === 0) {
			setTranscript((t) => [
				...t,
				{ kind: "meta", text: "No saved sessions yet." },
			]);
			return;
		}
		setSessionPicker({ sessions, cursorIndex: 0 });
	}, []);

	const openPersonaPickerModal = useCallback(() => {
		const people = listPersonas();
		const rows: PersonaPickerRow[] = [
			{ kind: "add" },
			...people.map((p) => ({ kind: "persona" as const, persona: p })),
		];
		setPersonaPicker({ rows, cursorIndex: 0 });
	}, []);

	const openPersonaEditorAtPath = useCallback((pathKeys: readonly string[]) => {
		setPersonaPicker(null);
		setConfigureSession(createConfigureSession());
		setConfigureInitialPath(pathKeys);
		setConfigureEditorItemKey(undefined);
		setConfigureMountKey((k) => k + 1);
		setShowConfig(true);
	}, []);

	const applyPersonaFromPicker = useCallback(async (p: Persona) => {
		const resolved = resolvePersona(p.name) ?? p;
		setActivePersona(resolved);
		setPersonaPicker(null);
		const sid = sessionIdRef.current;
		const mods = selectedModulesRef.current;
		const msgs = snapRef.current.messages;
		if (msgs && msgs.length > 0) {
			try {
				const next = await replaceSessionSystemMessageForPersona(
					mods,
					msgs,
					resolved,
				);
				setMessages(next);
				if (sid && next[0]) {
					appendMessageBatch(sid, 0, [next[0]]);
				}
			} catch (e) {
				setTranscript((t) => [
					...t,
					{
						kind: "error",
						text:
							e instanceof Error
								? e.message
								: "Failed to apply persona to session.",
					},
				]);
			}
		}
		setTranscript((t) => [
			...t,
			{ kind: "meta", text: `Switched persona to "${resolved.name}".` },
		]);
	}, []);

	const loadSessionIntoMemory = useCallback((id: string) => {
		const loaded = loadChatSession(id);
		log("info", "session", "session_load", { id, name: loaded?.name });
		if (!loaded) {
			setTranscript((t) => [
				...t,
				{ kind: "error", text: "Session not found." },
			]);
			return;
		}
		const tailCount = 12;
		const tail = loaded.transcript.slice(-tailCount);
		const resumeLine: TranscriptEntry = {
			kind: "meta",
			text: `Resumed "${loaded.name}" · showing last ${tail.length} lines`,
		};
		setSessionPicker(null);
		setSessionId(loaded.id);
		setSessionName(loaded.name);
		setSessionBootMode("loaded");
		didAutoRunFirstTurnRef.current = true;
		didNameSessionRef.current = true;
		lastSavedMessageCountRef.current = loaded.messages.length;
		// We append a "resume" line plus a replay tail to the in-memory transcript so the user
		// immediately sees recent context at the bottom (like an in-progress session).
		// Mark them as already persisted to avoid duplicating rows in SQLite.
		lastSavedTranscriptCountRef.current =
			loaded.transcript.length + 1 + tail.length;
		setBootError(null);
		setSessionPrompt("");
		setMessages(loaded.messages);
		setTranscript([...loaded.transcript, resumeLine, ...tail]);
		let maxSeq = 0;
		for (const e of loaded.transcript) {
			if (e.kind === "boxed_step" && e.seq > maxSeq) {
				maxSeq = e.seq;
			}
		}
		transcriptLocalSeqRef.current = maxSeq;

		// Load any incomplete plan for this session
		const plan = loadPlanBySession(loaded.id);
		if (
			plan &&
			(plan.status === "in_progress" || plan.status === "interrupted")
		) {
			setActivePlan(plan);
			activePlanRef.current = plan;
			const completedCount = plan.phases.filter(
				(p) => p.status === "completed",
			).length;
			setTranscript((t) => [
				...t,
				{
					kind: "meta",
					text: `Resuming plan: ${plan.goal} (${completedCount}/${plan.phases.length} phases complete)`,
				},
			]);
		} else {
			setActivePlan(null);
			activePlanRef.current = null;
		}
	}, []);

	const handlePromptSubmit = useCallback(
		(rawValue: string) => {
			// Terminal fallback: some setups send "\" before Enter for modified return.
			if (rawValue.endsWith("\\")) {
				setInput(`${rawValue.slice(0, -1)}\n`);
				return;
			}
			const line = rawValue.trim();
			setInput("");
			setInputCursorResetToken((token) => token + 1);

			// Steering prompt: if a turn is active, abort it and queue the
			// new prompt for processing once the abort completes.
			if (snapRef.current.loading && line) {
				pendingSteeringPromptRef.current = line;
				setRecentPrompts(appendPromptHistory(line));
				setTranscript((t) => [...t, { kind: "user", text: line }]);
				ongoingPretreatAbortRef.current?.abort();
				setActivityLine("Redirecting...");
				return;
			}

			if (line) {
				setRecentPrompts(appendPromptHistory(line));
			}
			const slash = resolveSlashSubmission(line, selectedSlashCommand);
			if (slash.kind === "execute" && slash.command) {
				void slash.command.run(
					{
						exit,
						openHelp: () => setShowHelp(true),
						openConfig: () => {
							setConfigureSession(createConfigureSession());
							setConfigureInitialPath(undefined);
							setConfigureEditorItemKey(undefined);
							setConfigureMountKey((k) => k + 1);
							setShowConfig(true);
						},
						openSkills: () => {
							setShowSkills(true);
						},
						openSchedules: () => {
							setShowSchedules(true);
						},
						openPersonaPicker: () => {
							openPersonaPickerModal();
						},
						openPersonaConfigure: (pathKeys) => {
							openPersonaEditorAtPath(pathKeys);
						},
						openIntegrationPicker: () => {
							void openIntegrationPicker();
						},
						openSessionsPicker: () => {
							openSessionsPicker();
						},
						startNewSession: () => {
							startFreshSession({
								prompt: "",
								note: "Started a new chat session.",
							});
						},
						chatIntegrationsCount: chatIntegrations.length,
						launchContext,
						addMetaLine: (text) => {
							setTranscript((t) => [...t, { kind: "meta", text }]);
						},
						setUpgradeStatus: setUpgradeUiStatus,
						getActivePlan: () => activePlanRef.current,
						skipPlanPhase: (planId: string, phaseId: string) => {
							skipPhase(planId, phaseId);
							const refreshed = loadPlanBySession(sessionIdRef.current ?? "");
							if (refreshed) {
								setActivePlan(refreshed);
								activePlanRef.current = refreshed;
							}
						},
						cancelPlan: (planId: string) => {
							cancelPlan(planId);
							const refreshed = loadPlanBySession(sessionIdRef.current ?? "");
							if (refreshed) {
								setActivePlan(refreshed);
								activePlanRef.current = refreshed;
							}
						},
					},
					slash.rawArgs,
				);
				return;
			}
			if (slash.kind === "unknown") {
				setTranscript((t) => [
					...t,
					{
						kind: "meta",
						text: `Unknown command: ${slash.attemptedToken ?? line}.`,
					},
				]);
				return;
			}
			if (!line) {
				return;
			}
			const msgs = snapRef.current.messages;
			if (!msgs) {
				return;
			}
			let sid = sessionIdRef.current;
			if (!sid) {
				const created = createChatSession({ name: "New chat" });
				sid = created.id;
				setSessionId(created.id);
				setSessionName(created.name);
				lastSavedMessageCountRef.current = 0;
				lastSavedTranscriptCountRef.current = 0;
			}
			const sidFinal = sid;
			void (async () => {
				const ac = new AbortController();
				ongoingPretreatAbortRef.current = ac;
				const msgsBefore = snapRef.current.messages;
				if (!msgsBefore) {
					return;
				}
				const isFirstTurn = !transcriptRef.current.some(
					(e) => e.kind === "user",
				);
				const willPretreat = shouldPretreat(msgsBefore, line, isFirstTurn);
				setLoading(true);
				setActivityLine(willPretreat ? "Preparing request…" : "Thinking…");
				const submitSeq = () => {
					transcriptLocalSeqRef.current += 1;
					return transcriptLocalSeqRef.current;
				};
				setTranscript((t) => [...t, { kind: "user", text: line }]);
				const prepId = willPretreat ? randomUUID() : null;
				if (willPretreat && prepId) {
					setTranscript((t) =>
						applyChatEvent(t, {
							type: "prep_start",
							id: prepId,
							seq: submitSeq(),
							header: "Prompt preparation",
						}),
					);
				}
				const localSkills = loadLocalSkills();
				const { content, spec } = await wrapUserPromptWithPretreatment({
					priorMessages: msgsBefore,
					rawUserText: line,
					integrationLabels: formatScopeLabel(selectedModulesRef.current),
					isFirstTurn,
					persona: activePersonaRef.current,
					skillsCatalog: localSkills,
					abortSignal: ac.signal,
				});
				const msgsAfter = snapRef.current.messages;
				if (!msgsAfter) {
					setLoading(false);
					return;
				}
				const mergeLifecycleId = randomUUID();
				const mergeStartEv = {
					type: "lifecycle_start" as const,
					id: mergeLifecycleId,
					seq: submitSeq(),
					header: "Updating session messages…",
				};
				setTranscript((t) => applyChatEvent(t, mergeStartEv));
				const mergeStartFooter = activityLineForChatEvent(mergeStartEv);
				if (mergeStartFooter !== null) {
					setActivityLine(mergeStartFooter);
				}
				const userMsg: CoreMessage = { role: "user", content };
				let next = [...msgsAfter, userMsg];
				next = injectSkillBodiesIntoFirstSystemMessage(
					next,
					spec?.relevantSkills ?? [],
					localSkills,
				);
				setMessages(next);
				const mergeEndEv = {
					type: "lifecycle_end" as const,
					id: mergeLifecycleId,
					seq: submitSeq(),
					detail: "Session messages updated.",
				};
				setTranscript((t) => applyChatEvent(t, mergeEndEv));
				const mergeEndFooter = activityLineForChatEvent(mergeEndEv);
				if (mergeEndFooter !== null) {
					setActivityLine(mergeEndFooter);
				}
				const skillDebugMeta = buildSkillDebugTranscriptEntries({
					debug,
					available: localSkills,
					priorMessages: msgsBefore,
					rawUserText: line,
					isFirstTurn,
					spec,
				});
				if (willPretreat && prepId) {
					const detail =
						process.env.TOBY_DEBUG_PREP === "1" &&
						spec &&
						content.trim() !== line.trim()
							? "Intent specification attached to the model message (debug)."
							: content.trim() !== line.trim()
								? "Intent specification attached to the model message."
								: "Request prepared.";
					const skillMeta = transcriptMetaForAttachedSkills(
						spec?.relevantSkills ?? [],
					);
					const prepEndEv = {
						type: "prep_end" as const,
						id: prepId,
						seq: submitSeq(),
						detail,
					};
					setTranscript((t) => [
						...applyChatEvent(t, prepEndEv),
						...skillDebugMeta,
						...skillMeta,
					]);
					const prepEndFooter = activityLineForChatEvent(prepEndEv);
					if (prepEndFooter !== null) {
						setActivityLine(prepEndFooter);
					}
				} else if (skillDebugMeta.length > 0) {
					setTranscript((t) => [...t, ...skillDebugMeta]);
				}
				await runModelTurnRef.current(next, sidFinal);
			})();
		},
		[
			chatIntegrations.length,
			debug,
			exit,
			launchContext,
			openIntegrationPicker,
			openPersonaEditorAtPath,
			openPersonaPickerModal,
			openSessionsPicker,
			selectedSlashCommand,
			startFreshSession,
		],
	);

	const handleGlobalInput = useCallback(
		(
			ch: string,
			key: {
				upArrow: boolean;
				downArrow: boolean;
				return: boolean;
				shift: boolean;
				escape: boolean;
				ctrl: boolean;
				meta: boolean;
				tab: boolean;
				backspace: boolean;
				delete: boolean;
			},
		) => {
			const modal = snapRef.current.askModal;
			if (modal) {
				const len = modal.options.length;
				if (key.upArrow) {
					setAskSelected((i) => (i <= 0 ? len - 1 : i - 1));
					return;
				}
				if (key.downArrow) {
					setAskSelected((i) => (i >= len - 1 ? 0 : i + 1));
					return;
				}
				if (key.return) {
					const idx = askSelectedRef.current;
					const label = modal.options[idx] ?? "";
					setActivityLine("Thinking…");
					modal.resolve({
						selectedIndex: idx,
						selectedLabel: label,
						rawInput: String(idx + 1),
					});
					setAskModal(null);
					return;
				}
				if (key.escape) {
					setActivityLine("Thinking…");
					modal.resolve({
						selectedIndex: -1,
						selectedLabel: "",
						rawInput: "",
						error: "Cancelled",
					});
					setAskModal(null);
					return;
				}
				return;
			}

			const picker = snapRef.current.multiPicker;
			if (picker) {
				const rows = buildIntegrationPickerRows(picker.modules);
				const len = rows.length;
				const cursor = picker.cursorIndex;

				if (key.upArrow) {
					setMultiPicker((p) =>
						p
							? {
									...p,
									cursorIndex: cursor <= 0 ? len - 1 : cursor - 1,
								}
							: p,
					);
					return;
				}
				if (key.downArrow) {
					setMultiPicker((p) =>
						p
							? {
									...p,
									cursorIndex: cursor >= len - 1 ? 0 : cursor + 1,
								}
							: p,
					);
					return;
				}

				if (ch === " ") {
					const row = rows[cursor];
					if (!row) {
						return;
					}
					setMultiPicker((p) => {
						if (!p) {
							return p;
						}
						if (row.kind === "all") {
							const allNames = p.modules.map((m) => m.name);
							const allSelected = allNames.every((n) =>
								p.selectedNames.includes(n),
							);
							return {
								...p,
								selectedNames: allSelected ? [] : [...allNames],
							};
						}
						const name = row.module.name;
						const has = p.selectedNames.includes(name);
						return {
							...p,
							selectedNames: toggleNameInList(p.selectedNames, name, !has),
						};
					});
					return;
				}

				if (key.return) {
					const currentPicker = snapRef.current.multiPicker;
					if (!currentPicker) {
						return;
					}
					const chosenNames = currentPicker.selectedNames;
					if (chosenNames.length === 0) {
						setTranscript((t) => [
							...t,
							{
								kind: "meta",
								text: "Select at least one integration (Space), then press Enter.",
							},
						]);
						return;
					}
					const nextModules = sortModulesByName(
						currentPicker.modules.filter((m) => chosenNames.includes(m.name)),
					);
					setMultiPicker(null);
					if (modulesEqual(nextModules, selectedModulesRef.current)) {
						setTranscript((t) => [
							...t,
							{
								kind: "meta",
								text: `Already using ${formatScopeLabel(nextModules)}.`,
							},
						]);
						return;
					}
					pendingScopeChangeNoteRef.current = `Using ${formatScopeLabel(nextModules)}.`;
					setBootError(null);
					setSessionPrompt("");
					didAutoRunFirstTurnRef.current = false;
					setMessages(null);
					setSelectedModules(nextModules);
					return;
				}

				if (key.escape) {
					setMultiPicker(null);
					return;
				}
				return;
			}

			const sessPicker = snapRef.current.sessionPicker;
			if (sessPicker) {
				const len = sessPicker.sessions.length;
				const cursor = sessPicker.cursorIndex;
				if (key.upArrow) {
					setSessionPicker((p) =>
						p
							? {
									...p,
									cursorIndex: cursor <= 0 ? len - 1 : cursor - 1,
								}
							: p,
					);
					return;
				}
				if (key.downArrow) {
					setSessionPicker((p) =>
						p
							? {
									...p,
									cursorIndex: cursor >= len - 1 ? 0 : cursor + 1,
								}
							: p,
					);
					return;
				}
				if (key.return) {
					const current = snapRef.current.sessionPicker;
					if (!current) return;
					const picked = current.sessions[current.cursorIndex];
					if (!picked) return;
					loadSessionIntoMemory(picked.id);
					return;
				}
				if (key.escape) {
					setSessionPicker(null);
					return;
				}
				return;
			}

			const persPicker = snapRef.current.personaPicker;
			if (persPicker) {
				const len = persPicker.rows.length;
				const cursor = persPicker.cursorIndex;
				if (key.upArrow) {
					setPersonaPicker((p) =>
						p
							? {
									...p,
									cursorIndex: cursor <= 0 ? len - 1 : cursor - 1,
								}
							: p,
					);
					return;
				}
				if (key.downArrow) {
					setPersonaPicker((p) =>
						p
							? {
									...p,
									cursorIndex: cursor >= len - 1 ? 0 : cursor + 1,
								}
							: p,
					);
					return;
				}
				if (key.return) {
					const row = persPicker.rows[persPicker.cursorIndex];
					if (!row) {
						return;
					}
					if (row.kind === "add") {
						const sess = createConfigureSession();
						const newName = sess.callbacks.onCreatePersona();
						setConfigureSession(refreshConfigureSessionTree(sess));
						setPersonaPicker(null);
						setConfigureInitialPath([
							"root",
							"personas",
							`personas.${newName}`,
						]);
						setConfigureEditorItemKey(`personas.${newName}.name`);
						setConfigureMountKey((k) => k + 1);
						setShowConfig(true);
						return;
					}
					void applyPersonaFromPicker(row.persona);
					return;
				}
				if (ch === "e" && !key.ctrl && !key.meta) {
					const row = persPicker.rows[persPicker.cursorIndex];
					if (row?.kind === "persona") {
						openPersonaEditorAtPath([
							"root",
							"personas",
							`personas.${row.persona.name}`,
						]);
					}
					return;
				}
				if (key.escape) {
					setPersonaPicker(null);
					return;
				}
				return;
			}

			if ((key.ctrl && ch === "c") || ch === "\x03") {
				exit();
				return;
			}

			if (snapRef.current.showHelp) {
				if (key.escape || key.return) {
					setShowHelp(false);
				}
				return;
			}

			if (snapRef.current.showKeyboardShortcuts) {
				if (key.escape || key.return) {
					setShowKeyboardShortcuts(false);
				}
				return;
			}
			if (showConfig || showSkills || showSchedules) {
				return;
			}

			if (snapRef.current.loading || !snapRef.current.messages) {
				if (key.escape && snapRef.current.loading) {
					ongoingPretreatAbortRef.current?.abort();
					setActivityLine("Turn cancelled.");
				}
				return;
			}

			if (key.tab && key.shift) {
				const allPersonas = listPersonas();
				if (allPersonas.length < 2) {
					return;
				}
				const currentIdx = allPersonas.findIndex(
					(p) => p.name === activePersonaRef.current.name,
				);
				const nextIdx = (currentIdx + 1) % allPersonas.length;
				const nextPersona = allPersonas[nextIdx];
				if (nextPersona) {
					void applyPersonaFromPicker(nextPersona);
				}
				return;
			}

			if (key.tab) {
				const completion = getNearestSlashCommand(input);
				if (!completion) {
					return;
				}
				const completed = `${completion.command} `;
				if (input !== completed) {
					setInput(completed);
				}
				// Explicitly request a caret reset so slash-completion always places
				// the cursor at the end, without relying on generic input-length changes.
				setInputCursorResetToken((token) => token + 1);
				return;
			}
		},
		[
			applyPersonaFromPicker,
			exit,
			input,
			loadSessionIntoMemory,
			openPersonaEditorAtPath,
			showConfig,
			showSkills,
			showSchedules,
		],
	);

	useInput(handleGlobalInput);

	const integrationCounts = useMemo(() => {
		const allModules = getIntegrationModules();
		let connected = 0;
		let disconnected = 0;
		for (const m of allModules) {
			const status = connectedByIntegration[m.name];
			if (status === true) connected++;
			else if (status === false) disconnected++;
		}
		return { connected, disconnected };
	}, [connectedByIntegration]);

	const skillsCount = useMemo(() => loadLocalSkills().length, []);

	if (bootError) {
		return (
			<Box flexDirection="column" padding={1}>
				<Text color="red">{bootError}</Text>
				<Text dimColor>Press Ctrl+C to exit.</Text>
			</Box>
		);
	}

	if (showHelp) {
		return <ChatHelpScreen termCols={termCols} commands={SLASH_COMMANDS} />;
	}

	if (showKeyboardShortcuts) {
		return <ChatKeyboardShortcutsScreen termCols={termCols} />;
	}

	if (showConfig) {
		return (
			<ConfigureApp
				key={configureMountKey}
				root={configureSession.initialTree}
				credentialValues={configureSession.initialValues}
				onSave={configureSession.onSave}
				refreshTree={configureSession.refreshTree}
				callbacks={configureSession.callbacks}
				initialPath={configureInitialPath}
				initialEditorItemKey={configureEditorItemKey}
				onQuitRequested={(values) => {
					configureSession.onSave(values);
					setShowConfig(false);
					setConfigureInitialPath(undefined);
					setConfigureEditorItemKey(undefined);
					setTranscript((t) => [
						...t,
						{ kind: "meta", text: "Configuration updated." },
					]);
					void (async () => {
						const cfg = readConfig();
						const prev = activePersonaRef.current;
						let nextP = resolvePersona(prev.name);
						if (!nextP && cfg.personas.length > 0) {
							const fallback = cfg.personas[0];
							if (fallback) {
								nextP = fallback;
								setTranscript((t) => [
									...t,
									{
										kind: "meta",
										text: `Active persona "${prev.name}" is gone; using "${fallback.name}".`,
									},
								]);
							}
						}
						if (!nextP) {
							return;
						}
						setActivePersona(nextP);
						const msgs = snapRef.current.messages;
						const mods = selectedModulesRef.current;
						if (msgs?.length) {
							try {
								const replaced = await replaceSessionSystemMessageForPersona(
									mods,
									msgs,
									nextP,
								);
								setMessages(replaced);
								const sid = sessionIdRef.current;
								if (sid && replaced[0]) {
									appendMessageBatch(sid, 0, [replaced[0]]);
								}
							} catch (e) {
								setTranscript((t) => [
									...t,
									{
										kind: "error",
										text:
											e instanceof Error
												? e.message
												: "Could not refresh system prompt after config.",
									},
								]);
							}
						}
					})();
				}}
			/>
		);
	}

	if (showSkills) {
		return (
			<SkillsApp
				onQuitRequested={() => {
					setShowSkills(false);
					setTranscript((t) => [
						...t,
						{ kind: "meta", text: "Skills view closed." },
					]);
				}}
			/>
		);
	}

	if (showSchedules) {
		return (
			<SchedulesApp
				onQuitRequested={() => {
					setShowSchedules(false);
					setTranscript((t) => [
						...t,
						{ kind: "meta", text: "Schedules view closed." },
					]);
				}}
			/>
		);
	}

	const displayRows = allDisplayRows;

	const inputDisabled =
		Boolean(askModal) ||
		Boolean(multiPicker) ||
		Boolean(sessionPicker) ||
		Boolean(personaPicker) ||
		messages === null ||
		showConfig ||
		showSkills ||
		showSchedules;
	const modelLabel = formatPersonaAiLabel(activePersona);

	const activityText =
		messages === null
			? bootActivityLine
			: loading
				? activityLine
				: connectionProbeLine;
	const activityDisplay =
		activityText.length > 0
			? `${ACTIVITY_GLYPH_FRAMES[activityGlyphFrame] ?? "·"} ${activityText}`
			: " ";
	const hasUserPromptInSession = transcript.some((e) => e.kind === "user");
	const suggestedPlaceholder =
		sessionBootMode === "new" && !hasUserPromptInSession
			? 'Try "What needs my attention today?"'
			: null;

	return (
		<Box flexDirection="column" width="100%" padding={1}>
			<AppHeader
				termCols={termCols}
				tip={tip}
				subheader={
					<Box flexDirection="row" justifyContent="center" gap={2}>
						<Text dimColor wrap="truncate-end">
							<Text color="green">{integrationCounts.connected}</Text> connected
						</Text>
						<Text dimColor wrap="truncate-end">
							<Text color="red">{integrationCounts.disconnected}</Text>{" "}
							disconnected
						</Text>
						{skillsCount > 0 ? (
							<Text dimColor wrap="truncate-end">
								<Text color={ACCENT}>{skillsCount}</Text> skill
								{skillsCount !== 1 ? "s" : ""}
							</Text>
						) : null}
						{dryRun ? (
							<Text dimColor wrap="truncate-end">
								dry-run
							</Text>
						) : null}
					</Box>
				}
			/>
			<Box flexDirection="column" marginTop={1} flexShrink={0}>
				{buildTranscriptNodes(displayRows, termCols)}
			</Box>
			<Box marginTop={1} width={termCols} flexShrink={0}>
				<Text dimColor wrap="truncate-end">
					{activityDisplay}
				</Text>
			</Box>
			{askModal ? (
				<AskUserModal
					modal={askModal}
					selectedIndex={askSelected}
					termCols={termCols}
				/>
			) : multiPicker ? (
				<IntegrationMultiPickerModal
					rows={pickerRows}
					cursorIndex={multiPicker.cursorIndex}
					selectedNames={selectedNameSet}
					termCols={termCols}
				/>
			) : sessionPicker ? (
				<ViewModal termCols={termCols} borderColor={ACCENT}>
					<Box width={termCols}>
						<Text bold wrap="truncate-end">
							Choose a session (Enter loads · Esc cancels)
						</Text>
					</Box>
					{sessionPicker.sessions.map((s, i) => {
						const active = i === sessionPicker.cursorIndex;
						return (
							<SelectableTextRow key={s.id} selected={active}>
								{s.name}
							</SelectableTextRow>
						);
					})}
					<Box marginTop={1}>
						<Text dimColor wrap="truncate-end">
							Loaded: {sessionName}
						</Text>
					</Box>
				</ViewModal>
			) : personaPicker ? (
				<ViewModal termCols={termCols} borderColor={ACCENT}>
					<Box width={termCols}>
						<Text bold wrap="truncate-end">
							Personas
						</Text>
					</Box>
					{personaPicker.rows.map((row, i) => {
						const active = i === personaPicker.cursorIndex;
						const defaultName = getDefaultPersonaName();
						const isDefault =
							row.kind === "persona" && row.persona.name === defaultName;
						const label =
							row.kind === "add"
								? "New persona…"
								: `${row.persona.name}${isDefault ? " ★" : ""}`;
						return (
							<SelectableTextRow
								key={row.kind === "add" ? "add" : row.persona.name}
								selected={active}
							>
								{label}
							</SelectableTextRow>
						);
					})}
					<Box marginTop={1}>
						<Text dimColor wrap="truncate-end">
							Active: {activePersona.name}
							{activePersona.name === getDefaultPersonaName()
								? " (default)"
								: ""}
						</Text>
					</Box>
					<Box marginTop={1}>
						<Text dimColor>
							↑↓ navigate · Enter select · e edit · Esc cancel
						</Text>
					</Box>
				</ViewModal>
			) : null}
			{activePlan &&
			activePlan.status !== "completed" &&
			activePlan.status !== "failed" ? (
				<PlanStatusBar plan={activePlan} termCols={termCols} />
			) : null}
			<ChatInputDock
				termCols={termCols}
				input={input}
				onInputChange={setInput}
				onInputSubmit={handlePromptSubmit}
				cursorResetToken={inputCursorResetToken}
				inputDisabled={inputDisabled}
				persona={activePersona}
				modelLabel={modelLabel}
				dryRun={dryRun}
				lastUsage={lastUsage}
				placeholder={suggestedPlaceholder}
				showPlaceholderWhenEmpty={!hasUserPromptInSession}
				slashSuggestions={slashSuggestions}
				selectedSlashCommand={selectedSlashCommand}
				daemonRunning={daemonRunning}
				recentPrompts={recentPrompts}
				updateAvailable={updateAvailable}
				upgradeUiStatus={upgradeUiStatus}
				onShowKeyboardShortcuts={() => setShowKeyboardShortcuts(true)}
				loading={loading}
			/>
		</Box>
	);
}
