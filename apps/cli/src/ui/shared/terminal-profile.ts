/**
 * Terminal capability detection and keymap profiles.
 *
 * Ink 7+ has built-in Kitty keyboard protocol support (auto-detected via
 * `render({ kittyKeyboard: { mode: 'auto' } })`). When active, `useInput`
 * provides accurate `key.shift`, `key.meta`, `key.super`, etc. for free.
 *
 * For terminals that we KNOW support the Kitty protocol, we use
 * `mode: 'enabled'` to bypass Ink's CSI probe, which can fail in some
 * environments (e.g. VS Code terminal) due to stdin buffering or timing.
 * For unknown terminals, `mode: 'auto'` probes safely and falls back
 * gracefully.
 *
 * For terminals without Kitty protocol support, we fall back to a
 * `TERM_PROGRAM`–based profile that maps known escape sequences to the
 * correct logical actions.
 */

export type ShiftEnterMode =
	| "native" // Kitty protocol — Ink reports key.shift accurately
	| "meta-return" // Terminal sends ESC + CR (iTerm2, VS Code integrated)
	| "escape-newline" // Terminal sends ESC + LF
	| "unsupported"; // Apple Terminal — swallows Shift+Enter entirely

export type MetaBackspaceMode =
	| "native" // Kitty protocol — Ink reports key.meta accurately
	| "escape-delete" // Terminal sends ESC + DEL
	| "ctrl-u" // Terminal maps Cmd+Backspace to Ctrl+U
	| "unsupported"; // No reliable sequence available

export type WordDeleteMode =
	| "native" // Kitty protocol handles it
	| "ctrl-w" // Ctrl+W is the standard fallback
	| "meta-delete" // ESC + DEL
	| "unsupported"; // No reliable sequence available

export interface TerminalProfile {
	/** Human-readable terminal name (e.g. "iTerm2", "Apple_Terminal"). */
	readonly name: string;
	/**
	 * Whether this terminal is known to support the Kitty keyboard protocol.
	 * When true, Ink's kittyKeyboard mode should be set to 'enabled' rather
	 * than 'auto' to bypass the potentially-unreliable CSI probe.
	 */
	readonly kittySupported: boolean;
	/** Whether the Kitty keyboard protocol was confirmed active at runtime. */
	readonly kittyProtocol: boolean;
	/** How Shift+Enter is encoded by this terminal. */
	readonly shiftEnter: ShiftEnterMode;
	/** How Meta+Backspace is encoded by this terminal. */
	readonly metaBackspace: MetaBackspaceMode;
	/** How word-delete-backward is encoded by this terminal. */
	readonly wordDelete: WordDeleteMode;
}

/** Profiles keyed by TERM_PROGRAM value. */
const KNOWN_PROFILES: Record<
	string,
	{
		name: string;
		kittySupported: boolean;
		shiftEnter: ShiftEnterMode;
		metaBackspace: MetaBackspaceMode;
		wordDelete: WordDeleteMode;
	}
> = {
	"iTerm.app": {
		name: "iTerm2",
		kittySupported: true,
		shiftEnter: "meta-return",
		metaBackspace: "escape-delete",
		wordDelete: "meta-delete",
	},
	Apple_Terminal: {
		name: "Apple Terminal",
		kittySupported: false,
		shiftEnter: "unsupported",
		metaBackspace: "ctrl-u",
		wordDelete: "ctrl-w",
	},
	WezTerm: {
		name: "WezTerm",
		kittySupported: true,
		shiftEnter: "native",
		metaBackspace: "native",
		wordDelete: "native",
	},
	ghostty: {
		name: "Ghostty",
		kittySupported: true,
		shiftEnter: "native",
		metaBackspace: "native",
		wordDelete: "native",
	},
	"xterm-kitty": {
		name: "Kitty",
		kittySupported: true,
		shiftEnter: "native",
		metaBackspace: "native",
		wordDelete: "native",
	},
	vscode: {
		name: "VS Code",
		// Do NOT force-enable Kitty protocol for VS Code. When
		// `mode: 'enabled'` is used but the terminal doesn't actually
		// support Kitty (user hasn't enabled
		// `terminal.integrated.enableKittyKeyboardProtocol`), Ink's
		// parser drops raw control bytes like 0x03 (Ctrl+C) because
		// they don't match Kitty encoding. Using `mode: 'auto'` lets
		// Ink fall back to basic parsing, which handles Ctrl+C and
		// other control sequences correctly. Shift+Enter is handled
		// by the backslash+CR heuristic in use-multiline-input.ts.
		kittySupported: false,
		shiftEnter: "native",
		metaBackspace: "native",
		wordDelete: "native",
	},
	Tabby: {
		name: "Tabby",
		kittySupported: true,
		shiftEnter: "native",
		metaBackspace: "native",
		wordDelete: "native",
	},
	foot: {
		name: "foot",
		kittySupported: true,
		shiftEnter: "native",
		metaBackspace: "native",
		wordDelete: "native",
	},
	WarpTerminal: {
		name: "Warp",
		kittySupported: true,
		shiftEnter: "native",
		metaBackspace: "native",
		wordDelete: "native",
	},
};

const UNKNOWN_PROFILE = {
	name: "unknown",
	kittySupported: false,
	shiftEnter: "unsupported" as ShiftEnterMode,
	metaBackspace: "unsupported" as MetaBackspaceMode,
	wordDelete: "ctrl-w" as WordDeleteMode,
};

/**
 * Detect the terminal profile from environment variables.
 * This is a synchronous, pure-function check — no I/O.
 */
export function detectTerminalProfile(): TerminalProfile {
	const termProgram = process.env.TERM_PROGRAM ?? "";
	const entry = KNOWN_PROFILES[termProgram];

	if (entry) {
		return {
			name: entry.name,
			kittySupported: entry.kittySupported,
			kittyProtocol: false,
			shiftEnter: entry.shiftEnter,
			metaBackspace: entry.metaBackspace,
			wordDelete: entry.wordDelete,
		};
	}

	// Fall back: check TERM for terminals that set it but not TERM_PROGRAM.
	const term = process.env.TERM ?? "";
	if (term === "xterm-kitty") {
		return {
			name: "Kitty",
			kittySupported: true,
			kittyProtocol: false,
			shiftEnter: "native",
			metaBackspace: "native",
			wordDelete: "native",
		};
	}
	if (term.startsWith("foot")) {
		return {
			name: "foot",
			kittySupported: true,
			kittyProtocol: false,
			shiftEnter: "native",
			metaBackspace: "native",
			wordDelete: "native",
		};
	}

	return {
		...UNKNOWN_PROFILE,
		kittyProtocol: false,
	};
}

/**
 * Resolve the Ink `kittyKeyboard.mode` value for the detected terminal.
 *
 * - Terminals known to support Kitty protocol get `'enabled'`, which
 *   force-enables the protocol without probing. This avoids the CSI probe
 *   timing out in environments like VS Code terminal where the response
 *   can be swallowed by Ink's own stdin pipeline.
 * - Unknown terminals get `'auto'`, which sends a harmless CSI probe and
 *   falls back gracefully if the terminal doesn't respond.
 * - Terminals known NOT to support Kitty (e.g. Apple Terminal) get
 *   `'disabled'` to skip the unnecessary probe.
 */
export function resolveKittyKeyboardMode(
	profile: TerminalProfile,
): "enabled" | "auto" | "disabled" {
	if (profile.kittySupported) return "enabled";
	if (profile.shiftEnter === "unsupported" && profile.name !== "unknown") {
		return "disabled";
	}
	return "auto";
}

/**
 * Mark a profile as having Kitty protocol confirmed active at runtime.
 * When Kitty is active, all modifier keys are reported natively, so we
 * override the profile modes to "native".
 */
export function withKittyProtocol(profile: TerminalProfile): TerminalProfile {
	if (profile.kittyProtocol) return profile;
	return {
		name: profile.name,
		kittySupported: profile.kittySupported,
		kittyProtocol: true,
		shiftEnter: "native",
		metaBackspace: "native",
		wordDelete: "native",
	};
}

/**
 * Return a short label for the current input mode, suitable for a status bar.
 * E.g. "kitty" or "legacy" or "vscode".
 */
export function inputModeLabel(profile: TerminalProfile): string {
	if (profile.kittyProtocol) return "kitty";
	if (profile.name === "unknown") return "legacy";
	// Compact: "VS Code" → "vscode", "Apple Terminal" → "applet"
	return profile.name.toLowerCase().replace(/\s+/g, "").slice(0, 7);
}
