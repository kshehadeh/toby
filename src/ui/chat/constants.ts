export const ACCENT = "#a16207";
export const META_ACCENT = "#0e7490";
// Accent-adjacent shades for compact status UI (provider/model split).
export const ACCENT_PROVIDER = "#d97706";
export const ACCENT_MODEL = "#f59e0b";
export const INPUT_BORDER = "gray";
/** Left margin for assistant reply boxes (characters). */
export const ASSISTANT_BOX_MARGIN_LEFT = 4;
/** Indent for tool result lines under a tool call (characters). */
export const TOOL_FEEDBACK_DETAIL_INDENT = 4;
/** Extra indent for body text inside a boxed step (characters). */
export const BOXED_STEP_BODY_MARGIN_LEFT = 2;

/** Rotating tips shown below the header in chat sessions. */
export const TIPS = [
	'Type "/" to see a list of commands you can run.',
	'Type "/config" to open the configuration settings.',
	"Associate integrations with organization tools (e.g. Gmail \u2194 E-Mail, Apple Calendar \u2194 Calendar) in the configuration view.",
	'Type "/scope" to change which integrations are active for the current session.',
	'Type "/help" to view all available slash commands and keyboard shortcuts.',
	"Use Tab to auto-complete slash commands.",
	'Type "/persona" to switch between different AI personas.',
	'Type "/sessions" to resume a previous chat session.',
] as const;

export const CHAT_TITLE_ASCII = [
	"████████╗ ██████╗ ██████╗ ██╗   ██╗",
	"╚══██╔══╝██╔═══██╗██╔══██╗╚██╗ ██╔╝",
	"   ██║   ██║   ██║██████╔╝ ╚████╔╝ ",
	"   ██║   ██║   ██║██╔══██╗  ╚██╔╝  ",
	"   ██║   ╚██████╔╝██████╔╝   ██║   ",
	"   ╚═╝    ╚═════╝ ╚═════╝    ╚═╝   ",
] as const;
