import { useInput } from "ink";
import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { reconcileCursorIndex } from "../chat/input-cursor";
import {
	resolveDeleteShortcutAction,
	resolveWordNavigationAction,
	wordBackwardIndex,
	wordForwardIndex,
} from "../chat/input-keymap";
import {
	isPromptHistoryEligibleInput,
	navigatePromptHistory,
} from "../chat/prompt-history-nav";
import {
	type TerminalProfile,
	detectTerminalProfile,
	withKittyProtocol,
} from "./terminal-profile";

/**
 * Maximum time (ms) to wait for an Enter event after receiving a backslash
 * before flushing the pending backslash as a regular character.
 *
 * Some terminals (e.g. VS Code without Kitty keyboard protocol enabled)
 * encode Shift+Enter as two sequential events: `\` then Enter. When we
 * see a `\` and can't rely on Kitty protocol for modifier detection, we
 * buffer it briefly. If Enter arrives within this window, we treat the
 * pair as Shift+Enter (insert newline). Otherwise, the backslash is
 * inserted normally.
 */
const PENDING_BACKSLASH_TIMEOUT_MS = 100;

export interface UseMultilineInputOptions {
	/** Current input value (controlled). */
	readonly value: string;
	/** Called when the value changes. */
	readonly onChange: (value: string) => void;
	/** Called when the user submits (plain Enter). */
	readonly onSubmit: (value: string) => void;
	/** Whether input handling is active. Defaults to true. */
	readonly active?: boolean;
	/**
	 * Token that changes when the cursor should be forced to the end of the
	 * input (e.g. after a submit clears the field). Increment to trigger.
	 */
	readonly cursorResetToken?: number;
	/**
	 * Enter key behaviour.
	 * - "submit"  : plain Enter submits, Shift/Ctrl/Meta+Enter inserts newline (default)
	 * - "newline" : plain Enter inserts newline, Ctrl+S submits
	 */
	readonly enterMode?: "submit" | "newline";
	/** Called on Escape when enterMode is "newline". Ignored for "submit" mode. */
	readonly onCancel?: () => void;
	/** Override the auto-detected terminal profile (for testing). */
	readonly profile?: TerminalProfile;
	/** Recent submitted prompts (newest last); ↑/↓ cycles when input is empty. */
	readonly recentPrompts?: readonly string[];
}

export interface UseMultilineInputReturn {
	/** Current cursor position within the value string. */
	readonly cursorIndex: number;
	/** The resolved terminal capability profile. */
	readonly terminalProfile: TerminalProfile;
}

export function useMultilineInput(
	options: UseMultilineInputOptions,
): UseMultilineInputReturn {
	const {
		value,
		onChange,
		onSubmit,
		active = true,
		cursorResetToken = 0,
		enterMode = "submit",
		onCancel,
		profile: profileOverride,
		recentPrompts = [],
	} = options;

	const [cursorIndex, setCursorIndex] = useState(value.length);
	const cursorIndexRef = useRef(value.length);
	const previousCursorResetTokenRef = useRef(cursorResetToken);
	const promptHistoryBrowseIndexRef = useRef(-1);
	const promptHistoryDraftRef = useRef("");

	// Pending-backslash heuristic: when Kitty protocol is not active, some
	// terminals (e.g. VS Code without `terminal.integrated.enableKittyKeyboardProtocol`)
	// encode Shift+Enter as `\` followed by Enter. We buffer a `\` character
	// and check if the next event is Enter; if so, we insert a newline instead.
	const pendingBackslashRef = useRef(false);
	const pendingBackslashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	const baseProfile = useMemo(
		() => profileOverride ?? detectTerminalProfile(),
		[profileOverride],
	);

	// Kitty protocol auto-detection is handled by Ink's render() option.
	// Once Ink confirms support, `useInput` reports accurate modifier state,
	// so we promote the profile to "native" for all key modes.
	const [kittyConfirmed, setKittyConfirmed] = useState(false);

	const terminalProfile = useMemo(
		() => (kittyConfirmed ? withKittyProtocol(baseProfile) : baseProfile),
		[kittyConfirmed, baseProfile],
	);

	const updateCursorIndex = useCallback(
		(next: number | ((previous: number) => number)) => {
			setCursorIndex((previous) => {
				const resolved = typeof next === "function" ? next(previous) : next;
				cursorIndexRef.current = resolved;
				return resolved;
			});
		},
		[],
	);

	useEffect(() => {
		const forceResetToEnd =
			previousCursorResetTokenRef.current !== cursorResetToken;
		previousCursorResetTokenRef.current = cursorResetToken;
		if (forceResetToEnd) {
			promptHistoryBrowseIndexRef.current = -1;
			promptHistoryDraftRef.current = "";
		}
		updateCursorIndex((prev) =>
			reconcileCursorIndex({
				currentCursorIndex: prev,
				nextInputLength: value.length,
				forceResetToEnd,
			}),
		);
	}, [cursorResetToken, value.length, updateCursorIndex]);

	// Clean up the pending-backslash timer on unmount.
	useEffect(() => {
		return () => {
			if (pendingBackslashTimerRef.current) {
				clearTimeout(pendingBackslashTimerRef.current);
			}
		};
	}, []);

	const deleteWordBackward = useCallback(() => {
		const ci = cursorIndexRef.current;
		if (ci <= 0) return;
		const start = wordBackwardIndex(value, ci);
		onChange(value.slice(0, start) + value.slice(ci));
		updateCursorIndex(start);
	}, [value, onChange, updateCursorIndex]);

	const insertAtCursor = useCallback(
		(text: string) => {
			promptHistoryBrowseIndexRef.current = -1;
			promptHistoryDraftRef.current = "";
			const ci = cursorIndexRef.current;
			const next = value.slice(0, ci) + text + value.slice(ci);
			onChange(next);
			updateCursorIndex(ci + text.length);
		},
		[value, onChange, updateCursorIndex],
	);

	const applyPromptHistoryNavigation = useCallback(
		(direction: "up" | "down") => {
			const result = navigatePromptHistory(
				direction,
				{
					browseIndex: promptHistoryBrowseIndexRef.current,
					draft: promptHistoryDraftRef.current,
				},
				recentPrompts,
			);
			if (!result) {
				return false;
			}
			promptHistoryBrowseIndexRef.current = result.browseIndex;
			promptHistoryDraftRef.current = result.draft;
			onChange(result.value);
			updateCursorIndex(result.value.length);
			return true;
		},
		[recentPrompts, onChange, updateCursorIndex],
	);

	// Debug logging for input events — set DEBUG_INPUT to a file path to enable.
	// Helps diagnose Shift+Enter issues across terminals.
	// Example: DEBUG_INPUT=/tmp/toby-input.log toby chat
	const debugStream = useMemo(() => {
		if (!process.env.DEBUG_INPUT) return null;
		const { createWriteStream } = require("node:fs") as typeof import("fs");
		return createWriteStream(process.env.DEBUG_INPUT, { flags: "a" });
	}, []);

	useInput(
		(typedInput, key) => {
			if (!active) return;

			if (debugStream) {
				const printable = typedInput
					.replace(/\n/g, "\\n")
					.replace(/\r/g, "\\r")
					.replace(/\t/g, "\\t")
					.replace(/\\/g, "\\\\");
				debugStream.write(
					`[input] typed=${JSON.stringify(printable)} ret=${key.return} shift=${key.shift} ctrl=${key.ctrl} meta=${key.meta} evtType=${key.eventType ?? "-"} up=${key.upArrow} down=${key.downArrow}\n`,
				);
			}

			// Detect Kitty protocol activation: Ink reports `key.eventType` only
			// when the Kitty keyboard protocol is active. On the first such event
			// we promote the profile so downstream consumers see "native" modes.
			if (key.eventType && !kittyConfirmed) {
				setKittyConfirmed(true);
			}

			// Flush pending-backslash timer if set.
			if (pendingBackslashTimerRef.current) {
				clearTimeout(pendingBackslashTimerRef.current);
				pendingBackslashTimerRef.current = null;
			}

			// --- Shift+Enter detection (non-Kitty terminals) ---
			// Some terminals encode Shift+Enter in ways that Ink doesn't
			// recognise as a modified Enter event. We handle three patterns:
			//
			// 1. VS Code (without enableKittyKeyboardProtocol) sends a
			//    SINGLE event with typedInput = "\\\r" (backslash + CR),
			//    key.return = false, key.shift = false.
			//
			// 2. Some terminals send TWO sequential events: `\` then Enter.
			//    The pending-backslash heuristic below buffers the `\` and
			//    checks if the next event is Enter.
			//
			// 3. With Kitty protocol active, key.shift is reported natively
			//    and no heuristic is needed.

			// Pattern 1: single-event backslash+CR (or backslash+LF).
			if (/^\\\r?$/.test(typedInput) || /^\\\n$/.test(typedInput)) {
				insertAtCursor("\n");
				return;
			}

			// Pattern 2: pending-backslash heuristic for two-event encoding.
			if (pendingBackslashRef.current) {
				pendingBackslashRef.current = false;
				const isEnter =
					key.return || typedInput === "\n" || typedInput === "\r";
				if (isEnter) {
					insertAtCursor("\n");
					return;
				}
				// Not Enter — flush the pending backslash as a real character.
				insertAtCursor("\\");
				// Fall through to process the current event normally.
			}

			const isEnter = key.return || typedInput === "\n" || typedInput === "\r";

			if (enterMode === "submit") {
				// With Kitty protocol or "meta-return" terminals, Ink correctly
				// reports key.shift/key.meta on modified Enter events. Without
				// Kitty, Shift+Enter is indistinguishable from plain Enter on
				// most terminals — the profile tells us what's available.
				const shouldSubmit = isEnter && !key.shift && !key.meta && !key.ctrl;
				const shouldNewline = isEnter && (key.shift || key.meta || key.ctrl);

				if (shouldSubmit) {
					onSubmit(value);
					return;
				}
				if (shouldNewline) {
					insertAtCursor("\n");
					return;
				}
			} else {
				// "newline" mode: Enter inserts a newline, Ctrl+S submits.
				if (key.ctrl && typedInput === "s") {
					onSubmit(value);
					return;
				}
				if (key.escape) {
					onCancel?.();
					return;
				}
				if (isEnter) {
					insertAtCursor("\n");
					return;
				}
			}

			// Ignore stray newline chars from Enter-like sequences not handled above.
			if (typedInput === "\r" || typedInput === "\n") return;

			// Ignore raw control characters that arrive without Kitty protocol
			// parsing (e.g. VS Code terminal sends \x03 for Ctrl+C instead of
			// key.ctrl=true + typedInput="c"). Without this guard, the raw
			// byte would be silently inserted into the input string.
			if (
				typedInput === "\x03" || // Ctrl+C (ETX)
				typedInput === "\x04" || // Ctrl+D (EOT)
				typedInput === "\x15" || // Ctrl+U (NAK)
				typedInput === "\x17" // Ctrl+W (ETB)
			) {
				return;
			}

			if (
				key.tab ||
				(key.shift && key.tab) ||
				(key.ctrl && typedInput === "c")
			) {
				return;
			}

			if (key.upArrow && recentPrompts.length > 0) {
				const browsing = promptHistoryBrowseIndexRef.current >= 0;
				if (browsing || isPromptHistoryEligibleInput(value)) {
					if (applyPromptHistoryNavigation("up")) {
						return;
					}
				}
			}

			if (
				key.downArrow &&
				recentPrompts.length > 0 &&
				promptHistoryBrowseIndexRef.current >= 0
			) {
				if (applyPromptHistoryNavigation("down")) {
					return;
				}
			}

			if (key.upArrow) {
				updateCursorIndex((ci) => {
					const lines = value.split("\n");
					let currentLineIndex = 0;
					let currentPos = 0;
					let col = 0;
					for (let i = 0; i < lines.length; i++) {
						const line = lines[i];
						const lineLen = line?.length ?? 0;
						const lineEnd = currentPos + lineLen;
						if (ci >= currentPos && ci <= lineEnd) {
							currentLineIndex = i;
							col = ci - currentPos;
							break;
						}
						currentPos = lineEnd + 1;
					}
					if (currentLineIndex > 0) {
						const targetLineIndex = currentLineIndex - 1;
						const targetLineLen = lines[targetLineIndex]?.length ?? 0;
						const newCol = Math.min(col, targetLineLen);
						let newIndex = 0;
						for (let i = 0; i < targetLineIndex; i++) {
							newIndex += (lines[i]?.length ?? 0) + 1;
						}
						return newIndex + newCol;
					}
					return ci;
				});
				return;
			}

			if (key.downArrow) {
				updateCursorIndex((ci) => {
					const lines = value.split("\n");
					let currentLineIndex = 0;
					let currentPos = 0;
					let col = 0;
					for (let i = 0; i < lines.length; i++) {
						const line = lines[i];
						const lineLen = line?.length ?? 0;
						const lineEnd = currentPos + lineLen;
						if (ci >= currentPos && ci <= lineEnd) {
							currentLineIndex = i;
							col = ci - currentPos;
							break;
						}
						currentPos = lineEnd + 1;
					}
					if (currentLineIndex < lines.length - 1) {
						const targetLineIndex = currentLineIndex + 1;
						const targetLineLen = lines[targetLineIndex]?.length ?? 0;
						const newCol = Math.min(col, targetLineLen);
						let newIndex = 0;
						for (let i = 0; i < targetLineIndex; i++) {
							newIndex += (lines[i]?.length ?? 0) + 1;
						}
						return newIndex + newCol;
					}
					return ci;
				});
				return;
			}

			const wordNav = resolveWordNavigationAction(typedInput, key);
			if (wordNav === "word-backward") {
				updateCursorIndex((ci) => wordBackwardIndex(value, ci));
				return;
			}
			if (wordNav === "word-forward") {
				updateCursorIndex((ci) => wordForwardIndex(value, ci));
				return;
			}
			if (wordNav === "line-start") {
				updateCursorIndex(0);
				return;
			}
			if (wordNav === "line-end") {
				updateCursorIndex(value.length);
				return;
			}

			if (key.leftArrow) {
				updateCursorIndex((ci) => Math.max(0, ci - 1));
				return;
			}
			if (key.rightArrow) {
				updateCursorIndex((ci) => Math.min(value.length, ci + 1));
				return;
			}

			// Terminal-friendly fallback for deleting previous word.
			if (key.ctrl && typedInput === "w") {
				deleteWordBackward();
				return;
			}

			const deleteAction = resolveDeleteShortcutAction(typedInput, key);
			if (deleteAction === "delete-word-backward") {
				promptHistoryBrowseIndexRef.current = -1;
				deleteWordBackward();
				return;
			}
			if (deleteAction === "delete-char") {
				const ci = cursorIndexRef.current;
				if (ci > 0) {
					promptHistoryBrowseIndexRef.current = -1;
					onChange(value.slice(0, ci - 1) + value.slice(ci));
					updateCursorIndex(ci - 1);
				}
				return;
			}

			if (typedInput) {
				// Pending-backslash heuristic: some terminals encode
				// Shift+Enter as two sequential events: `\` then Enter.
				// When this `\` event lacks `key.eventType` (meaning the
				// Kitty keyboard protocol did NOT report it as a real
				// keypress), we buffer it briefly. If the very next event
				// is Enter (within the timeout window), we treat the pair
				// as Shift+Enter and insert a newline instead. When Kitty
				// IS active, real `\` keypresses have `key.eventType` and
				// are inserted immediately with no delay.
				if (typedInput === "\\" && !key.eventType) {
					pendingBackslashRef.current = true;
					pendingBackslashTimerRef.current = setTimeout(() => {
						// Timeout: no Enter followed, so the `\` is a real
						// character. Insert it and clear the flag.
						pendingBackslashRef.current = false;
						pendingBackslashTimerRef.current = null;
						insertAtCursor("\\");
					}, PENDING_BACKSLASH_TIMEOUT_MS);
					return;
				}

				insertAtCursor(typedInput);
			}
		},
		{ isActive: active },
	);

	return { cursorIndex, terminalProfile };
}
