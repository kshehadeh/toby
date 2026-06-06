import {
	type TerminalProfile,
	detectTerminalProfile,
	inputModeLabel,
} from "../shared/terminal-profile";

export function buildTerminalInfoLines(
	profile: TerminalProfile = detectTerminalProfile(),
): readonly string[] {
	return [
		`Terminal: ${profile.name}`,
		`Kitty supported: ${profile.kittySupported ? "yes" : "no"}`,
		`Kitty protocol: ${profile.kittyProtocol ? "active" : "not confirmed"}`,
		`Input mode: ${inputModeLabel(profile)}`,
		`Shift+Enter: ${profile.shiftEnter}`,
		`Meta+Backspace: ${profile.metaBackspace}`,
		`Word delete: ${profile.wordDelete}`,
		`TERM_PROGRAM: ${process.env.TERM_PROGRAM ?? "(unset)"}`,
		`TERM: ${process.env.TERM ?? "(unset)"}`,
	];
}
