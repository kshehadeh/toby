import { randomUUID } from "node:crypto";
import { isAbortError, throwIfAborted } from "@toby/core/abort";
import type {
	AskUserHandler,
	AskUserToolResult,
} from "@toby/core/ai/ask-user-tool";
import {
	type SessionTokenTotals,
	addTurnToSessionTokenTotals,
	emptySessionTokenTotals,
	extractTokenUsageReport,
	formatCacheDebugMeta,
} from "@toby/core/ai/caching";
import type { CoreMessage } from "@toby/core/ai/chat";
import { formatChatModelError } from "@toby/core/ai/chat-errors";
import { formatPersonaAiLabel } from "@toby/core/ai/model-factory";
import {
	type AIProviderPlanUsage,
	fetchAIProviderPlanUsage,
} from "@toby/core/ai/plan-usage";
import { shouldPretreat } from "@toby/core/ai/pretreatment";
import {
	isIntegrationUsableInChat,
	modulesEqual,
	sortModulesByName,
} from "@toby/core/chat-integrations";
import type { ChatEvent } from "@toby/core/chat-pipeline/chat-events";
import { formatScopeLabel } from "@toby/core/chat-pipeline/format-scope-label";
import {
	type AssembledTurn,
	type PriorPretreatment,
	runChatTurnPipeline,
	withAssembledMessages,
} from "@toby/core/chat-pipeline/pipeline";
import { clearSessionToolBundleCache } from "@toby/core/chat-pipeline/run-turn";
import {
	type Persona,
	getDefaultPersonaName,
	getWebConfig,
	readConfig,
} from "@toby/core/config/index";
import { formatToolStatusLine } from "@toby/core/format-tool-status";
import {
	getIntegrationModules,
	getModulesForCategory,
	getModulesWithCapability,
} from "@toby/core/integrations/index";
import type { IntegrationModule } from "@toby/core/integrations/types";
import { transcribeWithPlugin } from "@toby/core/listen/transcription-plugin";
import {
	aggregateSessionTokenTotalsFromLog,
	createChatEventLogSink,
	formatLogEntry,
	log,
	logTurnSummary,
	readLogTail,
} from "@toby/core/logging/chat-log";
import { listPersonas, resolvePersona } from "@toby/core/personas/index";
import {
	activityLineForChatEvent,
	formatListeningToPersona,
} from "@toby/core/pipeline-footer";
import {
	type Plan,
	cancelPlan,
	createPlan,
	executePlan,
	generatePlan,
	loadPlanBySession,
	shouldGeneratePlan,
	skipPhase,
} from "@toby/core/planning/index";
import { replaceSessionSystemMessageForPersona } from "@toby/core/prepare-messages";
import {
	type Project,
	clearActiveProjectSlug,
	listProjectContextFiles,
	listProjectOutputFiles,
	listProjects,
	resolveActiveProject,
	resolveProject,
	setActiveProjectSlug,
} from "@toby/core/projects/index";
import {
	CHAT_SESSION_PICKER_LIMIT,
	appendMessageBatch,
	appendTranscriptBatch,
	createChatSession,
	listChatSessions,
	loadChatSession,
	renameChatSession,
} from "@toby/core/session-store";
import { loadLocalSkills } from "@toby/core/skills/index";
import { getToolDisplayLabel } from "@toby/core/tool-labels";
import { TobyDaemonClient, resolveDaemonBaseUrl } from "@toby/core/web/client";
import { openWebUiInBrowser } from "@toby/core/web/open-ui";
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
import { applyTranscriptFilesToMetadata } from "../../commands/listen";
import {
	startMacOSAudioCapture,
	waitForAudioHelperExit,
} from "../../listen/macos/audio-capture";
import {
	buildListenMetadata,
	discardListenSession,
	prepareListenSession,
	remapListenFilesToFinalDir,
	saveListenSession,
	writeListenMetadata,
} from "../../listen/session-controller";
import {
	ensureDaemonRunning,
	isDaemonRunning,
	restartDaemon,
} from "../../schedules/daemon-status";
import type { LaunchContext } from "../../toby-launch-context";
import { ConfigureApp } from "../configure/App";
import {
	createConfigureSession,
	refreshConfigureSessionTree,
} from "../configure/session";
import {
	DOT_GRID_SPINNER_FRAMES,
	DOT_GRID_SPINNER_INTERVAL_MS,
	SelectableTextRow,
	ViewModal,
} from "../shared";
import { ActivityStatusLine } from "./components/activity-status-line";
import { AppHeader } from "./components/app-header";
import { AskUserModal } from "./components/ask-user-modal";
import {
	ChatInputPanel,
	type ChatInputPanelHandle,
} from "./components/chat-input-panel";
import { ChatTranscriptPanel } from "./components/chat-transcript-panel";
import { HelpPanel } from "./components/help-panel";
import {
	IntegrationMultiPickerModal,
	buildIntegrationPickerRows,
} from "./components/integration-multi-picker-modal";
import { IssueReportModal } from "./components/issue-report-modal";
import { PlanStatusBar } from "./components/plan-status-bar";
import { ProjectDetailModal } from "./components/project-detail-modal";
import {
	ScrollableTextModal,
	maxScrollModalOffset,
	scrollModalVisibleLineBudget,
} from "./components/scrollable-text-modal";
import { UsagePanel } from "./components/usage-panel";
import {
	countIntegrationConnectionStatuses,
	runConnectionProbes,
} from "./connection-probe";
import { ACCENT, TIPS } from "./constants";
import { DaemonChatBridge } from "./daemon-chat-bridge";
import { buildHelpSections } from "./help-sections";
import { buildUiTurnContext } from "./pipeline-turn-context";
import { appendPromptHistory, loadPromptHistory } from "./prompt-history";
import { routePromptSubmit } from "./prompt-submit";
import { runDaemonChatTurn } from "./run-daemon-turn";
import {
	buildSessionNoticeEntry,
	buildTurnCancellationNoticeEntry,
	recordSessionNote,
} from "./session-note";
import { logSkillDebugNotes } from "./skill-debug";
import { SLASH_COMMANDS, getNearestSlashCommand } from "./slash-commands";
import type { SlashCommand } from "./slash-commands";
import { readTranscriptFile } from "./slash-commands/stop-listening";
import type { UpgradeUiStatus } from "./slash-commands/types";
import {
	isFirstSteeringTurn,
	priorMessagesForSteeringTurn,
} from "./steering-messages";
import { buildTerminalInfoLines } from "./terminal-info-lines";
import { logToolSelectionNotes } from "./tool-selection-transcript";
import { applyPersistedChatEvent } from "./transcript-events";
import { flattenTranscript } from "./transcript-layout";
import type { AskModal, DisplayRow, TranscriptEntry } from "./types";
import { buildUsageSections } from "./usage-sections";
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

type ProjectPickerRow =
	| { readonly kind: "clear" }
	| { readonly kind: "add" }
	| { readonly kind: "project"; readonly project: Project };

interface ProjectPickerState {
	readonly rows: readonly ProjectPickerRow[];
	readonly cursorIndex: number;
}

interface ProjectDetailState {
	readonly project: Project;
	readonly contextFiles: readonly string[];
	readonly outputFiles: readonly string[];
}

interface ScrollModalState {
	readonly title: string;
	readonly lines: readonly string[];
	readonly scrollOffset: number;
	readonly lineTone: "log" | "default" | "markdown";
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

function logAttachedSkills(
	sessionId: string | null | undefined,
	names: readonly string[],
): void {
	const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
	for (const name of unique) {
		recordSessionNote(sessionId, `Skill: ${name}`);
	}
}

function priorPretreatmentFromLastTurn(
	last: AssembledTurn | null,
	isFirstTurn: boolean,
): PriorPretreatment | undefined {
	if (isFirstTurn || !last?.spec) {
		return undefined;
	}
	return { rawUserText: last.rawUserText, spec: last.spec };
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
	const { columns, rows: terminalRows = 24 } = useWindowSize();
	const termCols = Math.max(24, columns - 2);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [sessionName, setSessionName] = useState<string>("New chat");
	const [sessionBootMode, setSessionBootMode] = useState<"new" | "loaded">(
		"new",
	);
	const [messages, setMessages] = useState<CoreMessage[] | null>(null);
	const bootLifecycleIdRef = useRef(randomUUID());
	const [transcript, setTranscript] = useState<TranscriptEntry[]>(() =>
		initialUserPrompt.trim() ? [{ kind: "user", text: initialUserPrompt }] : [],
	);
	const inputPanelRef = useRef<ChatInputPanelHandle>(null);
	const [recentPrompts, setRecentPrompts] = useState(() => loadPromptHistory());
	const [loading, setLoading] = useState(false);
	const [activityLine, setActivityLine] = useState(() =>
		formatListeningToPersona(persona.name),
	);
	const [streamingAssistant, setStreamingAssistant] = useState("");
	const [streamingReasoning, setStreamingReasoning] = useState("");
	const [streamingAssistantHeader, setStreamingAssistantHeader] = useState(
		persona.name,
	);
	const [lastUsage, setLastUsage] = useState<LanguageModelUsage | null>(null);
	const [sessionTokenTotals, setSessionTokenTotals] =
		useState<SessionTokenTotals>(() => emptySessionTokenTotals());
	const [usageOpen, setUsageOpen] = useState(false);
	const [usagePlanUsage, setUsagePlanUsage] =
		useState<AIProviderPlanUsage | null>(null);
	const [usagePlanLoading, setUsagePlanLoading] = useState(false);
	const [bootError, setBootError] = useState<string | null>(null);
	const [bootActivityLine, setBootActivityLine] =
		useState("Preparing session…");
	const [connectionProbeLine, setConnectionProbeLine] = useState("");
	const [askModal, setAskModal] = useState<AskModal | null>(null);
	const [askSelected, setAskSelected] = useState(0);
	const updateAvailable = useUpdateCheck({ enabled: !dryRun });
	const [upgradeUiStatus, setUpgradeUiStatus] = useState<UpgradeUiStatus>({
		status: "idle",
	});
	const [showConfig, setShowConfig] = useState(false);
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
	const [sessionPrompt, setSessionPrompt] = useState(initialUserPrompt);
	const [multiPicker, setMultiPicker] = useState<MultiPickerState | null>(null);
	const [sessionPicker, setSessionPicker] = useState<SessionPickerState | null>(
		null,
	);
	const [personaPicker, setPersonaPicker] = useState<PersonaPickerState | null>(
		null,
	);
	const [projectPicker, setProjectPicker] = useState<ProjectPickerState | null>(
		null,
	);
	const [projectDetail, setProjectDetail] = useState<ProjectDetailState | null>(
		null,
	);
	const [activeProject, setActiveProject] = useState<Project | null>(() =>
		resolveActiveProject(),
	);
	const activeProjectRef = useRef(activeProject);
	const [scrollModal, setScrollModal] = useState<ScrollModalState | null>(null);
	const [helpOpen, setHelpOpen] = useState(false);
	const [issueReportOpen, setIssueReportOpen] = useState(false);
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
	const progressNoticeIndexRef = useRef<number | null>(null);
	const transcriptRef = useRef(transcript);
	const ongoingPretreatAbortRef = useRef<AbortController | null>(null);
	const pendingSteeringPromptRef = useRef<string | null>(null);
	const inFlightUserPromptRef = useRef<string | null>(null);
	const [isListenRecording, setIsListenRecording] = useState(false);
	const listenHandleRef = useRef<
		import("../../listen/macos/audio-capture").AudioCaptureHandle | null
	>(null);
	const listenSessionRef = useRef<
		import("../../listen/types").ListenSession | null
	>(null);
	const listenHelperVersionRef = useRef<string | undefined>(undefined);
	const listenFilesRef = useRef<
		import("../../listen/types").ListenRecordingFiles
	>({});
	const listenErrorsRef = useRef<string[]>([]);
	const relevantToolsRef = useRef<readonly string[]>([]);
	const daemonBridgeRef = useRef<DaemonChatBridge | null>(null);
	const [daemonReady, setDaemonReady] = useState(false);
	const lastAssembledTurnRef = useRef<AssembledTurn | null>(null);
	const pretreatSessionNameRef = useRef<string | null>(null);
	const snapRef = useRef({
		askModal: null as AskModal | null,
		messages: null as CoreMessage[] | null,
		loading: false,
		multiPicker: null as MultiPickerState | null,
		sessionPicker: null as SessionPickerState | null,
		personaPicker: null as PersonaPickerState | null,
		projectPicker: null as ProjectPickerState | null,
		projectDetail: null as ProjectDetailState | null,
		scrollModal: null as ScrollModalState | null,
		helpOpen: false,
		usageOpen: false,
	});

	const allDisplayRows = useMemo((): DisplayRow[] => {
		if (messages === null && transcript.length === 0) {
			return [];
		}
		return flattenTranscript(
			transcript,
			streamingAssistant,
			streamingReasoning,
			messages === null || loading,
			termCols,
			streamingAssistantHeader,
			debug,
		);
	}, [
		messages,
		transcript,
		streamingAssistant,
		streamingReasoning,
		streamingAssistantHeader,
		loading,
		termCols,
		debug,
	]);

	const hasUserPromptInSession = useMemo(
		() => transcript.some((e) => e.kind === "user"),
		[transcript],
	);

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
		const modulesToProbe = getIntegrationModules();
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
							[event.module.name]: event.result.connected,
						}));
						const status = !event.result.connected
							? "disconnected"
							: event.result.healthy
								? "ready"
								: event.result.timedOut
									? "timed out"
									: "degraded";
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
	}, [messages]);

	const pickerRows = useMemo(
		() => (multiPicker ? buildIntegrationPickerRows(multiPicker.modules) : []),
		[multiPicker],
	);

	const selectedNameSet = useMemo(
		() => new Set(multiPicker?.selectedNames ?? []),
		[multiPicker?.selectedNames],
	);

	useLayoutEffect(() => {
		selectedModulesRef.current = selectedModules;
		clearSessionToolBundleCache();
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
			listenHandleRef.current?.dispose();
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
				(prev) => (prev + 1) % DOT_GRID_SPINNER_FRAMES.length,
			);
		}, DOT_GRID_SPINNER_INTERVAL_MS);
		return () => clearInterval(timer);
	}, [messages, loading]);

	useLayoutEffect(() => {
		activePersonaRef.current = activePersona;
	}, [activePersona]);

	useLayoutEffect(() => {
		activePlanRef.current = activePlan;
	}, [activePlan]);

	useLayoutEffect(() => {
		activeProjectRef.current = activeProject;
	}, [activeProject]);

	useLayoutEffect(() => {
		askSelectedRef.current = askSelected;
		snapRef.current = {
			askModal,
			messages,
			loading,
			multiPicker,
			sessionPicker,
			personaPicker,
			projectPicker,
			projectDetail,
			scrollModal,
			helpOpen,
			usageOpen,
		};
	}, [
		askModal,
		askSelected,
		loading,
		messages,
		multiPicker,
		sessionPicker,
		personaPicker,
		projectPicker,
		projectDetail,
		scrollModal,
		helpOpen,
		usageOpen,
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
			setTranscript([]);
			setLastUsage(null);
			setSessionTokenTotals(emptySessionTokenTotals());
			if (params?.note?.trim()) {
				recordSessionNote(null, params.note.trim());
			}
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

	const daemonTurnCallbacks = useCallback(
		() => ({
			persona: activePersonaRef.current,
			moduleNames,
			onActivityLine: setActivityLine,
			onLoading: setLoading,
			onStreamingClear: () => {
				setStreamingAssistant("");
				setStreamingReasoning("");
			},
			onStreamingDelta: (header: string, text: string) => {
				setStreamingAssistantHeader(header);
				setStreamingAssistant(text);
			},
			onReasoningDelta: (text: string) => {
				setStreamingReasoning(text);
			},
			onReasoningCommitted: (id: string, body: string) => {
				setStreamingReasoning("");
				setTranscript((t) => [
					...t,
					{
						kind: "boxed_step",
						id,
						seq: transcriptLocalSeqRef.current + 1,
						variant: "thinking",
						header: "Thinking",
						body,
					},
				]);
				transcriptLocalSeqRef.current += 1;
			},
			onTranscript: (
				updater: (entries: readonly TranscriptEntry[]) => TranscriptEntry[],
			) => {
				setTranscript(updater);
			},
			onUsage: setLastUsage,
			onSessionTokenTotals: setSessionTokenTotals,
			onSessionName: (name: string) => setSessionName(name),
			askUserHandler,
			nextSeq: () => {
				transcriptLocalSeqRef.current += 1;
				return transcriptLocalSeqRef.current;
			},
			sessionIdRef,
			pendingSteeringPromptRef,
		}),
		[askUserHandler, moduleNames],
	);

	useEffect(() => {
		let cancelled = false;
		const bridge = new DaemonChatBridge({
			persona: activePersona,
			modules: selectedModules,
			dryRun,
		});
		daemonBridgeRef.current = bridge;
		void (async () => {
			try {
				await bridge.connect();
				if (cancelled) return;
				setDaemonRunning(true);
				setDaemonReady(true);
				setBootActivityLine("Preparing session…");
			} catch (error) {
				if (!cancelled) {
					setBootError(error instanceof Error ? error.message : String(error));
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [activePersona, dryRun, selectedModules]);

	useEffect(() => {
		if (!daemonReady) return;
		daemonBridgeRef.current?.updatePersona(activePersona);
	}, [activePersona, daemonReady]);

	useEffect(() => {
		if (!daemonReady) return;
		daemonBridgeRef.current?.updateModules(selectedModules);
	}, [selectedModules, daemonReady]);

	const runModelTurn = useCallback(
		async (
			assembled: AssembledTurn,
			overrideSessionId?: string,
		): Promise<TurnResult> => {
			const sid = overrideSessionId ?? sessionIdRef.current;
			if (!sid) {
				throw new Error("Internal error: missing session id");
			}
			const bridge = daemonBridgeRef.current;
			if (!bridge) {
				throw new Error("Daemon API not ready");
			}
			ongoingPretreatAbortRef.current = new AbortController();
			try {
				const result = await runDaemonChatTurn({
					bridge,
					sessionId: sid,
					userText: assembled.rawUserText,
					callbacks: daemonTurnCallbacks(),
				});
				const loaded = await bridge.loadSession(sid);
				setMessages(
					loaded.messageCount > 0 ? [{ role: "user", content: "" }] : [],
				);
				return { text: result.text, responseMessages: [] };
			} catch {
				return { text: "", responseMessages: [] };
			}
		},
		[daemonTurnCallbacks],
	);

	useEffect(() => {
		if (!daemonReady || messages !== null || sessionBootMode === "loaded") {
			return;
		}

		let cancelled = false;
		void (async () => {
			try {
				const bridge = daemonBridgeRef.current;
				if (!bridge) {
					throw new Error("Daemon API not ready");
				}
				const created = await bridge.createSession({ bootstrap: true });
				if (cancelled) return;
				setSessionId(created.id);
				sessionIdRef.current = created.id;
				setSessionName(created.name);
				setMessages([]);
				setBootError(null);
				setBootActivityLine(formatListeningToPersona(activePersona.name));
				setActivityLine(formatListeningToPersona(activePersona.name));
			} catch (e) {
				if (!cancelled) {
					setBootError(formatChatModelError(e));
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [daemonReady, sessionBootMode, messages, activePersona.name]);

	// Daemon persists messages/transcript; skip local SQLite incremental writes.
	useEffect(() => {
		if (daemonReady) {
			return;
		}
		const sid = sessionId;
		if (!sid || !messages) {
			return;
		}
		const prev = lastSavedMessageCountRef.current;
		if (messages.length > prev) {
			appendMessageBatch(sid, prev, messages.slice(prev));
			lastSavedMessageCountRef.current = messages.length;
		}
	}, [messages, sessionId, daemonReady]);

	useEffect(() => {
		if (daemonReady) {
			return;
		}
		const sid = sessionId;
		if (!sid) {
			return;
		}
		const prev = lastSavedTranscriptCountRef.current;
		if (transcript.length > prev) {
			appendTranscriptBatch(sid, prev, transcript.slice(prev));
			lastSavedTranscriptCountRef.current = transcript.length;
		}
	}, [transcript, sessionId, daemonReady]);

	// Name the session once we have a real exchange.
	useEffect(() => {
		const sid = sessionId;
		if (!sid) return;
		if (didNameSessionRef.current) return;
		// Prefer pretreatment-provided session name (available immediately).
		const pretreatName = pretreatSessionNameRef.current;
		if (pretreatName) {
			renameChatSession(sid, pretreatName);
			setSessionName(pretreatName);
			didNameSessionRef.current = true;
			log("info", "session", "session_rename", {
				id: sid,
				name: pretreatName,
				source: "pretreatment",
			});
			return;
		}
		// Fallback: derive name from first user message once assistant has replied.
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
		log("info", "session", "session_rename", {
			id: sid,
			name: suggested,
			source: "transcript",
		});
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

		const sid = sessionId;
		if (!sid) {
			const bridge = daemonBridgeRef.current;
			if (!bridge) return;
			void bridge.createSession({ bootstrap: true }).then((created) => {
				setSessionId(created.id);
				setSessionName(created.name);
			});
			return;
		}
		const sidFinal = sid;
		const bridge = daemonBridgeRef.current;
		if (!bridge) return;

		void (async () => {
			setTranscript((t) => {
				const hasUser = t.some((e) => e.kind === "user");
				if (hasUser) return t;
				return [{ kind: "user", text: sessionPrompt }, ...t];
			});
			try {
				await runDaemonChatTurn({
					bridge,
					sessionId: sidFinal,
					userText: sessionPrompt,
					callbacks: daemonTurnCallbacks(),
				});
			} catch (e) {
				const msg = formatChatModelError(e);
				setTranscript((t) => [...t, { kind: "error", text: msg }]);
			}
		})();
	}, [bootError, messages, sessionPrompt, sessionId, daemonTurnCallbacks]);

	const runModelTurnRef = useRef(runModelTurn);
	runModelTurnRef.current = runModelTurn;

	// Process a pending steering prompt after an aborted turn finishes.
	useEffect(() => {
		if (loading) return;
		const steering = pendingSteeringPromptRef.current;
		if (!steering) return;

		const msgs = snapRef.current.messages;
		if (!msgs) return;
		pendingSteeringPromptRef.current = null;

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
			const prepAc = new AbortController();
			ongoingPretreatAbortRef.current = prepAc;
			const msgsBefore = snapRef.current.messages;
			if (!msgsBefore) return;

			const priorMessages = priorMessagesForSteeringTurn(
				msgsBefore,
				inFlightUserPromptRef.current,
			);
			if (priorMessages.length > msgsBefore.length) {
				inFlightUserPromptRef.current = null;
			}

			try {
				const isFirstTurn = isFirstSteeringTurn(priorMessages);
				const willPretreat = shouldPretreat(
					priorMessages,
					steering,
					isFirstTurn,
				);
				setLoading(true);
				setActivityLine(
					willPretreat
						? "Preparing request..."
						: formatListeningToPersona(activePersonaRef.current.name),
				);

				const prepResult = await runChatTurnPipeline(
					{
						rawUserText: steering,
						priorMessages,
						isFirstTurn,
						priorPretreatment: priorPretreatmentFromLastTurn(
							lastAssembledTurnRef.current,
							isFirstTurn,
						),
					},
					buildUiTurnContext({
						persona: activePersonaRef.current,
						modules: selectedModulesRef.current,
						dryRun,
						emit: (ev) => {
							const footerHint = activityLineForChatEvent(ev, {
								personaName: activePersonaRef.current.name,
							});
							if (footerHint !== null) {
								setActivityLine(footerHint);
							}
							setTranscript((t) => applyPersistedChatEvent(t, ev));
						},
						nextSeq: () => {
							transcriptLocalSeqRef.current += 1;
							return transcriptLocalSeqRef.current;
						},
						abortSignal: prepAc.signal,
						emitPersistLifecycle: false,
					}),
					{ stopAfter: "assemble" },
				);
				throwIfAborted(prepAc.signal);
				if (prepResult.stage !== "assemble") {
					throw new Error(
						`steering: expected assemble stage, got ${prepResult.stage}`,
					);
				}
				const assembled = prepResult.turn;
				lastAssembledTurnRef.current = assembled;
				relevantToolsRef.current = assembled.spec?.relevantTools ?? [];
				if (assembled.spec?.sessionName?.trim()) {
					pretreatSessionNameRef.current = assembled.spec.sessionName.trim();
				}

				const msgsAfter = snapRef.current.messages;
				if (!msgsAfter) {
					setLoading(false);
					return;
				}

				setMessages(assembled.messages);

				logAttachedSkills(sidFinal, assembled.spec?.relevantSkills ?? []);
				logToolSelectionNotes(sidFinal, {
					allToolNames: assembled.toolCatalog.allToolNames,
					toolIntegrationLabels: assembled.toolCatalog.toolIntegrationLabels,
					relevantTools: assembled.spec?.relevantTools,
					pretreatmentRan: assembled.spec !== null,
				});

				ongoingPretreatAbortRef.current = new AbortController();
				await runModelTurnRef.current(assembled, sidFinal);
			} catch (e) {
				if (isAbortError(e)) {
					if (prepAc.signal.aborted) {
						setTranscript((t) => [
							...t,
							buildTurnCancellationNoticeEntry(sessionIdRef.current),
						]);
						setLoading(false);
						return;
					}
					throw e;
				}
				throw e;
			}
		})();
	}, [loading, dryRun]);

	const openIntegrationPicker = useCallback(async () => {
		const usable: IntegrationModule[] = [];
		for (const m of chatIntegrations) {
			if (await isIntegrationUsableInChat(m)) {
				usable.push(m);
			}
		}
		if (usable.length === 0) {
			recordSessionNote(
				sessionIdRef.current,
				"No chat integrations ready to choose from (connect Gmail, add a Todoist API key, configure Slack, or configure Azure AD credentials).",
			);
			setActivityLine(
				"No integrations ready — connect an integration in configure.",
			);
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

	const openProjectPickerModal = useCallback(() => {
		const projects = listProjects();
		const rows: ProjectPickerRow[] = [
			{ kind: "clear" },
			{ kind: "add" },
			...projects.map((p) => ({ kind: "project" as const, project: p })),
		];
		setProjectPicker({ rows, cursorIndex: 0 });
	}, []);

	const openProjectEditorAtPath = useCallback((slug: string) => {
		setProjectPicker(null);
		setProjectDetail(null);
		setConfigureSession(createConfigureSession());
		setConfigureInitialPath(["root", "projects", `projects.${slug}`]);
		setConfigureEditorItemKey(`projects.${slug}.name`);
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
					activeProjectRef.current,
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
		recordSessionNote(
			sessionIdRef.current,
			`Switched persona to "${resolved.name}".`,
		);
	}, []);

	const applyProjectFromPicker = useCallback(async (slug: string | null) => {
		if (slug === null) {
			clearActiveProjectSlug();
			setActiveProject(null);
			recordSessionNote(sessionIdRef.current, "Cleared active project.");
		} else {
			const project = resolveProject(slug);
			if (!project) {
				recordSessionNote(sessionIdRef.current, `Project "${slug}" not found.`);
				return;
			}
			setActiveProjectSlug(slug);
			setActiveProject(project);
			recordSessionNote(
				sessionIdRef.current,
				`Switched project to "${project.name}".`,
			);
		}
		// Reboot the session so project context is injected fresh.
		setBootError(null);
		setSessionPrompt("");
		didAutoRunFirstTurnRef.current = false;
		setMessages(null);
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
		recordSessionNote(
			loaded.id,
			`Resumed "${loaded.name}" · showing last ${tail.length} lines`,
		);
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
			loaded.transcript.length + tail.length;
		setBootError(null);
		setSessionPrompt("");
		setMessages(loaded.messages);
		setTranscript([...loaded.transcript, ...tail]);
		setLastUsage(null);
		setSessionTokenTotals(aggregateSessionTokenTotalsFromLog(loaded.id));
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
			recordSessionNote(
				loaded.id,
				`Resuming plan: ${plan.goal} (${completedCount}/${plan.phases.length} phases complete)`,
			);
		} else {
			setActivePlan(null);
			activePlanRef.current = null;
		}
	}, []);

	const appendSessionNotice = useCallback(
		(text: string, tone?: "info" | "success" | "error") => {
			const trimmed = text.trim();
			if (trimmed.length === 0) {
				return;
			}
			recordSessionNote(sessionIdRef.current, trimmed);
			setTranscript((t) => [...t, buildSessionNoticeEntry(trimmed, tone)]);
		},
		[],
	);

	const updateProgressNotice = useCallback(
		async (text: string, tone: "info" | "success" | "error" = "info") => {
			const trimmed = text.trim();
			if (trimmed.length === 0) {
				return;
			}
			recordSessionNote(sessionIdRef.current, trimmed);
			setTranscript((t) => {
				const entry = buildSessionNoticeEntry(trimmed, tone);
				const idx = progressNoticeIndexRef.current;
				if (idx !== null && idx < t.length && t[idx]?.kind === "notice") {
					const next = [...t];
					next[idx] = entry;
					return next;
				}
				progressNoticeIndexRef.current = t.length;
				return [...t, entry];
			});
			await yieldToRenderer();
		},
		[],
	);

	const restartServer = useCallback(async () => {
		appendSessionNotice("Restarting server…", "info");
		try {
			const result = await restartDaemon();
			await daemonBridgeRef.current?.connect();
			setDaemonRunning(result.running);
			setDaemonReady(result.running);
			if (result.running && result.pid !== null) {
				appendSessionNotice(`Server restarted (PID ${result.pid}).`, "success");
				return;
			}
			appendSessionNotice("Server restart failed.", "error");
		} catch (e) {
			setDaemonReady(false);
			setDaemonRunning(false);
			appendSessionNotice(
				`Failed to restart server: ${e instanceof Error ? e.message : String(e)}`,
				"error",
			);
		}
	}, [appendSessionNotice]);

	const openLogViewer = useCallback(() => {
		const entries = readLogTail(50);
		const lines =
			entries.length === 0
				? ["Log is empty."]
				: entries.map((entry) => formatLogEntry(entry));
		setScrollModal({
			title: `Session log (last ${entries.length} entries)`,
			lines,
			scrollOffset: 0,
			lineTone: "log",
		});
	}, []);

	const openTerminalViewer = useCallback(() => {
		setScrollModal({
			title: "Terminal capabilities",
			lines: buildTerminalInfoLines(),
			scrollOffset: 0,
			lineTone: "default",
		});
	}, []);

	const openTextViewer = useCallback(
		(
			title: string,
			lines: readonly string[],
			options?: { readonly lineTone?: "default" | "markdown" },
		) => {
			setScrollModal({
				title,
				lines: [...lines],
				scrollOffset: 0,
				lineTone: options?.lineTone ?? "default",
			});
		},
		[],
	);

	const helpSections = useMemo(() => buildHelpSections(SLASH_COMMANDS), []);

	const openHelpViewer = useCallback(() => {
		setHelpOpen(true);
	}, []);

	const submitIssueReport = useCallback(
		async (type: "bug" | "feature", details: string) => {
			setIssueReportOpen(false);
			appendSessionNotice("Submitting issue report…", "info");
			try {
				const daemon = await ensureDaemonRunning();
				if (!daemon.running) {
					appendSessionNotice(
						"Failed to start server. Try `toby daemon start` and then `/issue` again.",
						"error",
					);
					return;
				}

				const webCfg = getWebConfig();
				const baseUrl = resolveDaemonBaseUrl(webCfg.port);
				const client = new TobyDaemonClient({ baseUrl });
				const result = await client.createIssue({
					type,
					details,
					metadata: { source: "tui" },
				});

				if (result.ok) {
					appendSessionNotice(
						`Issue created: ${result.url} (#${result.number})`,
						"success",
					);
					return;
				}

				const opened = await openWebUiInBrowser(result.fallbackUrl);
				appendSessionNotice(
					opened
						? `Opened a pre-filled issue report. ${result.reason}`
						: `Could not open browser. Visit this URL to complete the report:\n${result.fallbackUrl}`,
					"info",
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				appendSessionNotice(
					`Failed to submit issue report: ${message}`,
					"error",
				);
			}
		},
		[appendSessionNotice],
	);

	const openUsageViewer = useCallback(() => {
		const providerId = activePersonaRef.current.ai.provider;
		setUsageOpen(true);
		setUsagePlanLoading(true);
		void fetchAIProviderPlanUsage(providerId)
			.then((usage) => {
				setUsagePlanUsage(usage);
			})
			.catch(() => {
				setUsagePlanUsage(null);
			})
			.finally(() => {
				setUsagePlanLoading(false);
			});
	}, []);

	const usageSections = useMemo(
		() =>
			buildUsageSections({
				persona: activePersona,
				sessionName,
				sessionTokenTotals,
				lastUsage,
				planUsage: usagePlanUsage,
				planUsageLoading: usagePlanLoading,
			}),
		[
			activePersona,
			sessionName,
			sessionTokenTotals,
			lastUsage,
			usagePlanUsage,
			usagePlanLoading,
		],
	);

	const handlePromptSubmit = useCallback(
		(rawValue: string, selectedSlashCommand: SlashCommand | null) => {
			const inputPanel = inputPanelRef.current;
			// Terminal fallback: some setups send "\" before Enter for modified return.
			if (rawValue.endsWith("\\")) {
				inputPanel?.setInput(`${rawValue.slice(0, -1)}\n`);
				return;
			}
			const line = rawValue.trim();
			inputPanel?.clearInput();

			const routed = routePromptSubmit(
				line,
				selectedSlashCommand,
				snapRef.current.loading,
			);
			if (routed.kind === "empty") {
				return;
			}

			if (routed.kind === "steering") {
				// Turn is active: abort it and queue the new prompt for later.
				pendingSteeringPromptRef.current = routed.line;
				setRecentPrompts(appendPromptHistory(routed.line));
				setTranscript((t) => [...t, { kind: "user", text: routed.line }]);
				const sid = sessionIdRef.current;
				if (sid) {
					daemonBridgeRef.current?.cancelActiveTurn(sid);
				}
				ongoingPretreatAbortRef.current?.abort();
				setActivityLine("Redirecting...");
				return;
			}

			if (line) {
				setRecentPrompts(appendPromptHistory(line));
			}

			if (routed.kind === "slash") {
				const slash = routed.resolution;
				if (slash.kind === "execute" && slash.command) {
					void slash.command.run(
						{
							exit,
							openHelp: openHelpViewer,
							openIssueReport: () => {
								setIssueReportOpen(true);
							},
							openUsageViewer,
							openLogViewer,
							openTerminalViewer,
							openTextViewer,
							openConfig: () => {
								setConfigureSession(createConfigureSession());
								setConfigureInitialPath(undefined);
								setConfigureEditorItemKey(undefined);
								setConfigureMountKey((k) => k + 1);
								setShowConfig(true);
							},
							openSkills: () => {
								setConfigureSession(createConfigureSession());
								setConfigureInitialPath(["root", "skills"]);
								setConfigureEditorItemKey(undefined);
								setConfigureMountKey((k) => k + 1);
								setShowConfig(true);
							},
							openSchedules: () => {
								setConfigureSession(createConfigureSession());
								setConfigureInitialPath(["root", "schedules"]);
								setConfigureEditorItemKey(undefined);
								setConfigureMountKey((k) => k + 1);
								setShowConfig(true);
							},
							openPersonaPicker: () => {
								openPersonaPickerModal();
							},
							openPersonaConfigure: (pathKeys) => {
								openPersonaEditorAtPath(pathKeys);
							},
							openProjectPicker: () => {
								openProjectPickerModal();
							},
							openProjectConfigure: (slug) => {
								openProjectEditorAtPath(slug);
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
							restartServer,
							chatIntegrationsCount: chatIntegrations.length,
							launchContext,
							addMetaLine: (text) => {
								recordSessionNote(sessionIdRef.current, text);
							},
							addNoticeLine: (text, tone) => {
								appendSessionNotice(text, tone);
							},
							updateProgressNotice,
							addUserContextMessage: (text) => {
								recordSessionNote(sessionIdRef.current, text);
								setMessages((msgs) =>
									msgs
										? [
												...msgs,
												{
													role: "user" as const,
													content: text,
												},
											]
										: msgs,
								);
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
							startListenRecording: () => {
								if (listenHandleRef.current) return;
								try {
									const session = prepareListenSession({
										sources: { mic: true, system: true },
									});
									listenHelperVersionRef.current = undefined;
									listenFilesRef.current = {};
									listenErrorsRef.current = [];
									const handle = startMacOSAudioCapture({
										session,
										onEvent: (event) => {
											if (event.type === "ready") {
												listenHelperVersionRef.current = event.helperVersion;
												listenFilesRef.current = {
													...listenFilesRef.current,
													...(event.files ?? {}),
												};
												appendSessionNotice(
													"Recording started. Use /stop-listening to stop.",
													"success",
												);
												return;
											}
											if (event.type === "error") {
												listenErrorsRef.current = [
													...listenErrorsRef.current,
													event.message,
												];
												setTranscript((t) => [
													...t,
													{
														kind: "error",
														text: `Recording error: ${event.message}`,
													},
												]);
												listenHandleRef.current = null;
												listenSessionRef.current = null;
												setIsListenRecording(false);
												return;
											}
											if ("files" in event && event.files) {
												listenFilesRef.current = {
													...listenFilesRef.current,
													...event.files,
												};
											}
										},
									});
									listenHandleRef.current = handle;
									listenSessionRef.current = session;
									setIsListenRecording(true);
								} catch (error) {
									const msg =
										error instanceof Error ? error.message : String(error);
									setTranscript((t) => [
										...t,
										{
											kind: "error",
											text: `Could not start recording: ${msg}`,
										},
									]);
								}
							},
							stopListenRecording: async (action) => {
								const handle = listenHandleRef.current;
								const session = listenSessionRef.current;
								if (!handle || !session) return null;
								try {
									await handle.stop(action);
									await waitForAudioHelperExit(handle.child);
									listenHandleRef.current = null;
									listenSessionRef.current = null;
									setIsListenRecording(false);
									if (action === "discard") {
										discardListenSession(session);
										return null;
									}
									const savedFiles = remapListenFilesToFinalDir(
										session,
										listenFilesRef.current,
									);
									const metadata = buildListenMetadata({
										session,
										files: savedFiles,
										stoppedAt: new Date(),
										helperVersion: listenHelperVersionRef.current,
										errors: listenErrorsRef.current,
									});
									const outputDir = saveListenSession(session, metadata);
									const helperPath = handle.helperPath;
									let transcript = readTranscriptFile(outputDir);
									let transcriptionError: string | undefined;
									if (!transcript && savedFiles.combined) {
										try {
											const transcriptFiles = await transcribeWithPlugin({
												input: savedFiles.combined,
												outDir: outputDir,
											});
											writeListenMetadata(
												outputDir,
												applyTranscriptFilesToMetadata(metadata, {
													...savedFiles,
													...transcriptFiles,
												}),
											);
											transcript = readTranscriptFile(outputDir);
										} catch (transcribeError) {
											const msg =
												transcribeError instanceof Error
													? transcribeError.message
													: String(transcribeError);
											transcriptionError = msg;
											listenErrorsRef.current = [
												...listenErrorsRef.current,
												msg,
											];
											writeListenMetadata(
												outputDir,
												buildListenMetadata({
													session,
													files: savedFiles,
													stoppedAt: new Date(),
													helperVersion: listenHelperVersionRef.current,
													errors: listenErrorsRef.current,
												}),
											);
										}
									}
									return { outputDir, transcript, transcriptionError };
								} catch (error) {
									const msg =
										error instanceof Error ? error.message : String(error);
									listenHandleRef.current = null;
									listenSessionRef.current = null;
									setIsListenRecording(false);
									setTranscript((t) => [
										...t,
										{
											kind: "error",
											text: `Could not finalize recording: ${msg}`,
										},
									]);
									return null;
								}
							},
							isListenRecording: () => listenHandleRef.current !== null,
						},
						slash.rawArgs,
					);
					return;
				}
				if (slash.kind === "unknown") {
					appendSessionNotice(
						`Unknown command: ${slash.attemptedToken ?? line}.`,
						"error",
					);
					return;
				}
				return;
			}

			if (routed.kind !== "chat") {
				return;
			}
			const msgs = snapRef.current.messages;
			if (msgs === null) {
				return;
			}
			const sid = sessionIdRef.current;
			const bridge = daemonBridgeRef.current;
			if (!bridge) {
				appendSessionNotice("Server API not ready.", "error");
				return;
			}
			if (!sid) {
				void bridge.createSession({ bootstrap: true }).then((created) => {
					setSessionId(created.id);
					setSessionName(created.name);
				});
				return;
			}
			const sidFinal = sid;
			void (async () => {
				try {
					inFlightUserPromptRef.current = line;
					setTranscript((t) => [...t, { kind: "user", text: line }]);
					await runDaemonChatTurn({
						bridge,
						sessionId: sidFinal,
						userText: line,
						callbacks: daemonTurnCallbacks(),
					});
					inFlightUserPromptRef.current = null;
				} catch (e) {
					if (isAbortError(e)) {
						if (pendingSteeringPromptRef.current) {
							recordSessionNote(sessionIdRef.current, "Redirecting...");
							return;
						}
						setTranscript((t) => [
							...t,
							buildTurnCancellationNoticeEntry(sessionIdRef.current),
						]);
						return;
					}
					const msg = formatChatModelError(e);
					setTranscript((t) => [...t, { kind: "error", text: msg }]);
				}
			})();
		},
		[
			appendSessionNotice,
			chatIntegrations.length,
			daemonTurnCallbacks,
			exit,
			launchContext,
			openIntegrationPicker,
			openHelpViewer,
			openUsageViewer,
			openLogViewer,
			openTerminalViewer,
			openTextViewer,
			openPersonaEditorAtPath,
			openPersonaPickerModal,
			openProjectEditorAtPath,
			openProjectPickerModal,
			openSessionsPicker,
			restartServer,
			startFreshSession,
			updateProgressNotice,
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
					setActivityLine(
						formatListeningToPersona(activePersonaRef.current.name),
					);
					modal.resolve({
						selectedIndex: idx,
						selectedLabel: label,
						rawInput: String(idx + 1),
					});
					setAskModal(null);
					return;
				}
				if (key.escape) {
					setActivityLine(
						formatListeningToPersona(activePersonaRef.current.name),
					);
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
						recordSessionNote(
							sessionIdRef.current,
							"Select at least one integration (Space), then press Enter.",
						);
						return;
					}
					const nextModules = sortModulesByName(
						currentPicker.modules.filter((m) => chosenNames.includes(m.name)),
					);
					setMultiPicker(null);
					if (modulesEqual(nextModules, selectedModulesRef.current)) {
						recordSessionNote(
							sessionIdRef.current,
							`Already using ${formatScopeLabel(nextModules)}.`,
						);
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

			const projPicker = snapRef.current.projectPicker;
			if (projPicker) {
				const len = projPicker.rows.length;
				const cursor = projPicker.cursorIndex;
				if (key.upArrow) {
					setProjectPicker((p) =>
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
					setProjectPicker((p) =>
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
					const row = projPicker.rows[projPicker.cursorIndex];
					if (!row) {
						return;
					}
					if (row.kind === "clear") {
						setProjectPicker(null);
						void applyProjectFromPicker(null);
						return;
					}
					if (row.kind === "add") {
						const sess = createConfigureSession();
						const newSlug = sess.callbacks.onCreateProject();
						setConfigureSession(refreshConfigureSessionTree(sess));
						setProjectPicker(null);
						setConfigureInitialPath([
							"root",
							"projects",
							`projects.${newSlug}`,
						]);
						setConfigureEditorItemKey(`projects.${newSlug}.name`);
						setConfigureMountKey((k) => k + 1);
						setShowConfig(true);
						return;
					}
					if (row.kind === "project") {
						setProjectDetail({
							project: row.project,
							contextFiles: listProjectContextFiles(row.project),
							outputFiles: listProjectOutputFiles(row.project),
						});
						setProjectPicker(null);
						return;
					}
					return;
				}
				if (ch === "e" && !key.ctrl && !key.meta) {
					const row = projPicker.rows[projPicker.cursorIndex];
					if (row?.kind === "project") {
						openProjectEditorAtPath(row.project.slug);
					}
					return;
				}
				if (key.escape) {
					setProjectPicker(null);
					return;
				}
				return;
			}

			const projDetail = snapRef.current.projectDetail;
			if (projDetail) {
				if (ch === "a" && !key.ctrl && !key.meta) {
					const slug = projDetail.project.slug;
					setProjectDetail(null);
					void applyProjectFromPicker(slug);
					return;
				}
				if (ch === "e" && !key.ctrl && !key.meta) {
					openProjectEditorAtPath(projDetail.project.slug);
					return;
				}
				if (key.escape) {
					setProjectDetail(null);
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

			if (snapRef.current.helpOpen) {
				if (key.escape || key.return) {
					setHelpOpen(false);
					return;
				}
				return;
			}

			if (snapRef.current.usageOpen) {
				if (key.escape || key.return) {
					setUsageOpen(false);
					return;
				}
				return;
			}

			const scrollView = snapRef.current.scrollModal;
			if (scrollView) {
				const visibleBudget = scrollModalVisibleLineBudget(terminalRows);
				const maxOffset = maxScrollModalOffset(
					scrollView.lines.length,
					visibleBudget,
				);
				if (key.escape || key.return) {
					setScrollModal(null);
					return;
				}
				if (key.downArrow) {
					setScrollModal((prev) =>
						prev
							? {
									...prev,
									scrollOffset: Math.min(prev.scrollOffset + 1, maxOffset),
								}
							: prev,
					);
					return;
				}
				if (key.upArrow) {
					setScrollModal((prev) =>
						prev
							? {
									...prev,
									scrollOffset: Math.max(prev.scrollOffset - 1, 0),
								}
							: prev,
					);
					return;
				}
				return;
			}

			if (showConfig) {
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
				const inputPanel = inputPanelRef.current;
				const currentInput = inputPanel?.getInput() ?? "";
				const completion = getNearestSlashCommand(currentInput);
				if (!completion) {
					return;
				}
				const completed = `${completion.command} `;
				if (currentInput !== completed) {
					inputPanel?.setInput(completed);
				}
				// Explicitly request a caret reset so slash-completion always places
				// the cursor at the end, without relying on generic input-length changes.
				inputPanel?.bumpCursorReset();
				return;
			}
		},
		[
			applyProjectFromPicker,
			applyPersonaFromPicker,
			exit,
			loadSessionIntoMemory,
			openPersonaEditorAtPath,
			openProjectEditorAtPath,
			showConfig,
			terminalRows,
		],
	);

	useInput(handleGlobalInput);

	const integrationCounts = useMemo(
		() =>
			countIntegrationConnectionStatuses(
				getIntegrationModules(),
				connectedByIntegration,
			),
		[connectedByIntegration],
	);

	const skillsCount = useMemo(() => loadLocalSkills().length, []);

	if (bootError) {
		return (
			<Box flexDirection="column" padding={1}>
				<Text color="red">{bootError}</Text>
				<Text dimColor>Press Ctrl+C to exit.</Text>
			</Box>
		);
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
					recordSessionNote(sessionIdRef.current, "Configuration updated.");
					void (async () => {
						const cfg = readConfig();
						const prev = activePersonaRef.current;
						let nextP = resolvePersona(prev.name);
						if (!nextP && cfg.personas.length > 0) {
							const fallback = cfg.personas[0];
							if (fallback) {
								nextP = fallback;
								recordSessionNote(
									sessionIdRef.current,
									`Active persona "${prev.name}" is gone; using "${fallback.name}".`,
								);
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

	const inputDisabled =
		Boolean(askModal) ||
		Boolean(multiPicker) ||
		Boolean(sessionPicker) ||
		Boolean(projectPicker) ||
		Boolean(projectDetail) ||
		Boolean(personaPicker) ||
		Boolean(scrollModal) ||
		helpOpen ||
		usageOpen ||
		issueReportOpen ||
		messages === null ||
		showConfig;
	const modelLabel = formatPersonaAiLabel(activePersona);

	const activityText =
		messages === null
			? bootActivityLine
			: loading
				? activityLine
				: connectionProbeLine;
	const activityAnimating = messages === null || loading;
	const suggestedPlaceholder =
		sessionBootMode === "new" && !hasUserPromptInSession
			? 'Try "What needs my attention today?"'
			: null;

	return (
		<Box flexDirection="column" width="100%" padding={1}>
			<AppHeader
				termCols={termCols}
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
			<ChatTranscriptPanel
				rows={allDisplayRows}
				termCols={termCols}
				animFrame={activityGlyphFrame}
			/>
			<ActivityStatusLine
				text={activityText}
				animating={activityAnimating}
				termCols={termCols}
				frame={activityGlyphFrame}
			/>
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
					{sessionPicker.sessions.length === 0 ? (
						<Box marginTop={1}>
							<Text dimColor wrap="truncate-end">
								No saved sessions yet.
							</Text>
						</Box>
					) : (
						sessionPicker.sessions.map((s, i) => {
							const active = i === sessionPicker.cursorIndex;
							return (
								<SelectableTextRow key={s.id} selected={active}>
									{s.name}
								</SelectableTextRow>
							);
						})
					)}
					<Box marginTop={1}>
						<Text dimColor wrap="truncate-end">
							Loaded: {sessionName}
						</Text>
					</Box>
				</ViewModal>
			) : projectPicker ? (
				<ViewModal termCols={termCols} borderColor={ACCENT}>
					<Box width={termCols}>
						<Text bold wrap="truncate-end">
							Projects
						</Text>
					</Box>
					{projectPicker.rows.map((row, i) => {
						const active = i === projectPicker.cursorIndex;
						const isActive =
							row.kind === "project" &&
							row.project.slug === activeProject?.slug;
						const label =
							row.kind === "clear"
								? "No project"
								: row.kind === "add"
									? "New project…"
									: `${row.project.name}${isActive ? " ★" : ""}`;
						return (
							<SelectableTextRow
								key={
									row.kind === "clear"
										? "clear"
										: row.kind === "add"
											? "add"
											: row.project.slug
								}
								selected={active}
							>
								{label}
							</SelectableTextRow>
						);
					})}
					<Box marginTop={1}>
						<Text dimColor wrap="truncate-end">
							Active: {activeProject?.name ?? "none"}
						</Text>
					</Box>
					<Box marginTop={1}>
						<Text dimColor>
							↑↓ navigate · Enter select · e edit · Esc cancel
						</Text>
					</Box>
				</ViewModal>
			) : projectDetail ? (
				<ProjectDetailModal
					termCols={termCols}
					project={projectDetail.project}
					contextFiles={projectDetail.contextFiles}
					outputFiles={projectDetail.outputFiles}
					isActive={projectDetail.project.slug === activeProject?.slug}
				/>
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
			) : helpOpen ? (
				<HelpPanel termCols={termCols} sections={helpSections} />
			) : issueReportOpen ? (
				<IssueReportModal
					termCols={termCols}
					onSubmit={submitIssueReport}
					onCancel={() => setIssueReportOpen(false)}
				/>
			) : usageOpen ? (
				<UsagePanel termCols={termCols} sections={usageSections} />
			) : scrollModal ? (
				<ScrollableTextModal
					termCols={termCols}
					title={scrollModal.title}
					lines={scrollModal.lines}
					scrollOffset={scrollModal.scrollOffset}
					lineTone={scrollModal.lineTone}
				/>
			) : null}
			{activePlan &&
			activePlan.status !== "completed" &&
			activePlan.status !== "failed" ? (
				<PlanStatusBar plan={activePlan} termCols={termCols} />
			) : null}
			<ChatInputPanel
				ref={inputPanelRef}
				termCols={termCols}
				onSubmit={handlePromptSubmit}
				inputDisabled={inputDisabled}
				persona={activePersona}
				project={activeProject}
				modelLabel={modelLabel}
				dryRun={dryRun}
				lastUsage={lastUsage}
				placeholder={suggestedPlaceholder}
				showPlaceholderWhenEmpty={!hasUserPromptInSession}
				daemonRunning={daemonRunning}
				recentPrompts={recentPrompts}
				updateAvailable={updateAvailable}
				upgradeUiStatus={upgradeUiStatus}
				onShowKeyboardShortcuts={openHelpViewer}
				loading={loading}
				isListenRecording={isListenRecording}
				tip={tip}
			/>
		</Box>
	);
}
