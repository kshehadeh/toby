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
import type { CoreMessage } from "../../ai/chat";
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
import { type Persona, readConfig } from "../../config/index";
import { getModulesWithCapability } from "../../integrations/index";
import type { IntegrationModule } from "../../integrations/types";
import { listPersonas, resolvePersona } from "../../personas/index";
import { loadLocalSkills } from "../../skills/index";
import { ConfigureApp } from "../configure/App";
import {
	createConfigureSession,
	refreshConfigureSessionTree,
} from "../configure/session";
import { applyChatEvent } from "./chat-event-reducer";
import { AppHeader } from "./components/app-header";
import { AskUserModal } from "./components/ask-user-modal";
import { ChatHelpScreen } from "./components/chat-help-screen";
import { ChatInputDock } from "./components/chat-input-dock";
import {
	IntegrationMultiPickerModal,
	buildIntegrationPickerRows,
} from "./components/integration-multi-picker-modal";
import { buildTranscriptNodes } from "./components/transcript";
import { ACCENT } from "./constants";
import { formatToolStatusLine } from "./format-tool-status";
import {
	injectSkillBodiesIntoFirstSystemMessage,
	prepareChatSessionMessages,
	replaceSessionSystemMessageForPersona,
} from "./prepare-messages";
import { runIntegrationChatTurn } from "./run-turn";
import {
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
import { flattenTranscript } from "./transcript-layout";
import type { AskModal, DisplayRow, TranscriptEntry } from "./types";

interface ChatSessionAppProps {
	readonly initialModules: readonly IntegrationModule[];
	readonly persona: Persona;
	readonly dryRun: boolean;
	readonly debug: boolean;
	readonly initialUserPrompt: string;
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

function formatScopeLabel(modules: readonly IntegrationModule[]): string {
	if (modules.length === 0) {
		return "(none)";
	}
	return modules.map((m) => m.displayName).join(" + ");
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

export function ChatSessionApp({
	initialModules,
	persona,
	dryRun,
	debug,
	initialUserPrompt,
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
	const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
	const [input, setInput] = useState("");
	const [inputCursorResetToken, setInputCursorResetToken] = useState(0);
	const [loading, setLoading] = useState(false);
	const [activityLine, setActivityLine] = useState("Thinking…");
	const [streamingAssistant, setStreamingAssistant] = useState("");
	const [streamingAssistantHeader, setStreamingAssistantHeader] =
		useState("Toby");
	const [lastUsage, setLastUsage] = useState<LanguageModelUsage | null>(null);
	const [bootError, setBootError] = useState<string | null>(null);
	const [askModal, setAskModal] = useState<AskModal | null>(null);
	const [askSelected, setAskSelected] = useState(0);
	const [showHelp, setShowHelp] = useState(false);
	const [showConfig, setShowConfig] = useState(false);
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
	const assistantSegmentHeaderRef = useRef("Toby");
	const transcriptLocalSeqRef = useRef(0);
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
	const snapRef = useRef({
		askModal: null as AskModal | null,
		messages: null as CoreMessage[] | null,
		loading: false,
		showHelp: false,
		multiPicker: null as MultiPickerState | null,
		sessionPicker: null as SessionPickerState | null,
		personaPicker: null as PersonaPickerState | null,
	});

	const allDisplayRows = useMemo((): DisplayRow[] => {
		if (messages === null) {
			return [];
		}
		return flattenTranscript(
			transcript,
			streamingAssistant,
			loading,
			termCols,
			streamingAssistantHeader,
		);
	}, [
		messages,
		transcript,
		streamingAssistant,
		streamingAssistantHeader,
		loading,
		termCols,
	]);

	const chatIntegrations = useMemo(
		() => getModulesWithCapability("chat").filter((m) => m.chat),
		[],
	);

	const moduleNames = useMemo(
		() => selectedModules.map((m) => m.name),
		[selectedModules],
	);

	useEffect(() => {
		let cancelled = false;
		const names = selectedModules.map((m) => m.name);
		// Mark as unknown while we refresh.
		setConnectedByIntegration((prev) => {
			const next: Record<string, boolean | null> = { ...prev };
			for (const n of names) {
				next[n] = null;
			}
			return next;
		});
		void (async () => {
			const pairs = await Promise.all(
				selectedModules.map(async (m) => {
					try {
						return [m.name, await m.isConnected()] as const;
					} catch {
						return [m.name, false] as const;
					}
				}),
			);
			if (cancelled) return;
			setConnectedByIntegration((prev) => {
				const next: Record<string, boolean | null> = { ...prev };
				for (const [name, ok] of pairs) {
					next[name] = ok;
				}
				return next;
			});
		})();
		return () => {
			cancelled = true;
		};
	}, [selectedModules]);

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
		askSelectedRef.current = askSelected;
		snapRef.current = {
			askModal,
			messages,
			loading,
			showHelp,
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
			transcriptLocalSeqRef.current = 0;
			setBootError(null);
			setSessionPrompt(params?.prompt ?? "");
			didAutoRunFirstTurnRef.current = false;
			setMessages(null);
			setTranscript(params?.note ? [{ kind: "meta", text: params.note }] : []);
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
		async (msgs: CoreMessage[], overrideSessionId?: string) => {
			const sid = overrideSessionId ?? sessionIdRef.current;
			if (!sid) {
				throw new Error("Internal error: missing session id");
			}
			setLoading(true);
			setActivityLine("Thinking…");
			setStreamingAssistant("");
			setStreamingAssistantHeader("Toby");
			assistantStreamBufRef.current = "";
			assistantSegmentCommittedRef.current = false;
			let activeToolCalls = 0;
			const nextLocalSeq = () => {
				transcriptLocalSeqRef.current += 1;
				return transcriptLocalSeqRef.current;
			};
			const emitChatEvent = (ev: ChatEvent) => {
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
			try {
				const out = await runIntegrationChatTurn(moduleNames, msgs, {
					persona: activePersona,
					dryRun,
					askUser: askUserHandler,
					chatWithToolsOptions: {
						onChatEvent: emitChatEvent,
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

				const reply = out.text?.trim() || "";

				const additions: TranscriptEntry[] = [];
				if (reply.length > 0 && !assistantSegmentCommittedRef.current) {
					additions.push({
						kind: "boxed_step",
						id: randomUUID(),
						seq: nextLocalSeq(),
						variant: "assistant",
						header: "Toby",
						body: reply,
					});
				}
				if (
					process.env.TOBY_DEBUG_CACHE === "1" &&
					out.usage?.inputTokenDetails
				) {
					const d = out.usage.inputTokenDetails;
					const pieces = [
						d.cacheReadTokens !== undefined
							? `cacheRead=${d.cacheReadTokens}`
							: null,
						d.cacheWriteTokens !== undefined
							? `cacheWrite=${d.cacheWriteTokens}`
							: null,
						d.noCacheTokens !== undefined ? `noCache=${d.noCacheTokens}` : null,
					].filter(Boolean);
					if (pieces.length > 0) {
						additions.push({
							kind: "meta",
							text: `Usage: ${pieces.join(" · ")}`,
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
				setTranscript((t) => [...t, ...additions]);
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
				const msg = e instanceof Error ? e.message : String(e);
				setTranscript((t) => [...t, { kind: "error", text: msg }]);
			} finally {
				setLoading(false);
			}
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
				const localSkills = loadLocalSkills();
				let effectivePrompt = sessionPrompt;
				let prepId: string | null = null;
				if (sessionPrompt.trim() && shouldPretreat([], sessionPrompt, true)) {
					prepId = randomUUID();
				}
				let prepSpec: UserIntentSpec | null = null;
				let bootTranscript: TranscriptEntry[] = [];
				if (sessionPrompt.trim()) {
					if (prepId) {
						bootTranscript = applyChatEvent(bootTranscript, {
							type: "prep_start",
							id: prepId,
							seq: bootSeq(),
							header: "Prompt preparation",
						});
					}
					const wrapResult = await wrapUserPromptWithPretreatment({
						priorMessages: [],
						rawUserText: sessionPrompt,
						integrationLabels: formatScopeLabel(selectedModules),
						isFirstTurn: true,
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
						bootTranscript = applyChatEvent(bootTranscript, {
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
				let initial = await prepareChatSessionMessages(
					selectedModules,
					activePersona,
					effectivePrompt,
				);
				initial = injectSkillBodiesIntoFirstSystemMessage(
					initial,
					prepSpec?.relevantSkills ?? [],
					localSkills,
				);
				if (cancelled) {
					return;
				}
				setMessages(initial);
				const userEntries: TranscriptEntry[] = sessionPrompt.trim()
					? [{ kind: "user", text: sessionPrompt }]
					: [];
				const note = pendingScopeChangeNoteRef.current;
				pendingScopeChangeNoteRef.current = null;
				const metaEntries: TranscriptEntry[] = note
					? [{ kind: "meta", text: note }]
					: [];
				const skillMeta = transcriptMetaForAttachedSkills(
					prepSpec?.relevantSkills ?? [],
				);
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
					...userEntries,
					...metaEntries,
				];
				setTranscript(nextTranscript);

				// Persist boot state only after a session is materialized.
				if (sid) {
					appendMessageBatch(sid, 0, initial);
					lastSavedMessageCountRef.current = initial.length;
					if (nextTranscript.length > 0) {
						appendTranscriptBatch(sid, 0, nextTranscript);
						lastSavedTranscriptCountRef.current = nextTranscript.length;
					}
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
		void runModelTurn(messages);
	}, [bootError, messages, runModelTurn, sessionPrompt]);

	const runModelTurnRef = useRef(runModelTurn);
	runModelTurnRef.current = runModelTurn;

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
					text: "No chat integrations ready to choose from (connect Gmail, add a Todoist API key, or configure Azure AD credentials).",
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
		const sessions = listChatSessions(100).map((s) => ({
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
			const slash = resolveSlashSubmission(line, selectedSlashCommand);
			if (slash.kind === "execute" && slash.command) {
				void slash.command.run({
					exit,
					openHelp: () => setShowHelp(true),
					openConfig: () => {
						setConfigureSession(createConfigureSession());
						setConfigureInitialPath(undefined);
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
					addMetaLine: (text) => {
						setTranscript((t) => [...t, { kind: "meta", text }]);
					},
				});
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
					setTranscript((t) => [
						...applyChatEvent(t, {
							type: "prep_end",
							id: prepId,
							seq: submitSeq(),
							detail,
						}),
						...skillDebugMeta,
						...skillMeta,
					]);
				} else if (skillDebugMeta.length > 0) {
					setTranscript((t) => [...t, ...skillDebugMeta]);
				}
				setTranscript((t) => [...t, { kind: "user", text: line }]);
				setActivityLine("Thinking…");
				await runModelTurnRef.current(next, sidFinal);
			})();
		},
		[
			chatIntegrations.length,
			debug,
			exit,
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

			if (key.ctrl && ch === "c") {
				exit();
				return;
			}

			if (snapRef.current.showHelp) {
				if (key.escape || key.return) {
					setShowHelp(false);
				}
				return;
			}
			if (showConfig) {
				return;
			}

			if (snapRef.current.loading || !snapRef.current.messages) {
				return;
			}

			if (key.tab) {
				const completion = getNearestSlashCommand(input);
				if (!completion) {
					return;
				}
				const normalizedInput = input.trim().toLowerCase();
				if (normalizedInput !== completion.command) {
					setInput(`${completion.command} `);
					setInputCursorResetToken((token) => token + 1);
				}
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
		],
	);

	useInput(handleGlobalInput);

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

	const displayRows = allDisplayRows;

	const inputDisabled =
		Boolean(askModal) ||
		Boolean(multiPicker) ||
		Boolean(sessionPicker) ||
		Boolean(personaPicker) ||
		loading ||
		showConfig;
	const modelLabel = `${activePersona.ai.provider}/${activePersona.ai.model}`;
	const activityText =
		messages === null ? "Loading session…" : loading ? activityLine : "";
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
				subheader={
					selectedModules.length === 0 ? (
						<Text dimColor wrap="truncate-end">
							No integrations enabled.
							{dryRun ? "  ·  dry-run" : ""}
						</Text>
					) : (
						<Box flexDirection="row" flexWrap="wrap" justifyContent="center">
							{selectedModules.map((m, idx) => {
								const ok = connectedByIntegration[m.name];
								return (
									<Text key={m.name} dimColor wrap="truncate-end">
										{idx === 0 ? "" : "  "}
										{ok === true ? (
											<Text color="green">✓</Text>
										) : ok === false ? (
											<Text color="red">✗</Text>
										) : (
											<Text dimColor>…</Text>
										)}{" "}
										{m.displayName}
									</Text>
								);
							})}
							{dryRun ? (
								<Text dimColor wrap="truncate-end">
									{"  ·  "}dry-run
								</Text>
							) : null}
						</Box>
					)
				}
			/>
			<Box flexDirection="column" marginTop={0} flexShrink={0}>
				{buildTranscriptNodes(displayRows, termCols)}
			</Box>
			<Box marginTop={0} width={termCols} flexShrink={0}>
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
				<Box
					marginTop={1}
					flexShrink={0}
					flexDirection="column"
					borderStyle="round"
					borderColor={ACCENT}
					paddingX={1}
				>
					<Box width={termCols}>
						<Text bold wrap="truncate-end">
							Choose a session (Enter loads · Esc cancels)
						</Text>
					</Box>
					{sessionPicker.sessions.map((s, i) => {
						const active = i === sessionPicker.cursorIndex;
						const prefix = active ? "› " : "  ";
						return (
							<Box key={s.id} width={termCols}>
								<Text color={active ? ACCENT : undefined} wrap="truncate-end">
									{prefix}
									{s.name}
								</Text>
							</Box>
						);
					})}
					<Box marginTop={1}>
						<Text dimColor wrap="truncate-end">
							Loaded: {sessionName}
						</Text>
					</Box>
				</Box>
			) : personaPicker ? (
				<Box
					marginTop={1}
					flexShrink={0}
					flexDirection="column"
					borderStyle="round"
					borderColor={ACCENT}
					paddingX={1}
				>
					<Box width={termCols}>
						<Text bold wrap="truncate-end">
							Personas (Enter select · e edit · Esc cancel)
						</Text>
					</Box>
					{personaPicker.rows.map((row, i) => {
						const active = i === personaPicker.cursorIndex;
						const prefix = active ? "› " : "  ";
						const label =
							row.kind === "add" ? "New persona…" : row.persona.name;
						return (
							<Box
								key={row.kind === "add" ? "add" : row.persona.name}
								width={termCols}
							>
								<Text color={active ? ACCENT : undefined} wrap="truncate-end">
									{prefix}
									{label}
								</Text>
							</Box>
						);
					})}
					<Box marginTop={1}>
						<Text dimColor wrap="truncate-end">
							Active: {activePersona.name}
						</Text>
					</Box>
				</Box>
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
			/>
		</Box>
	);
}
