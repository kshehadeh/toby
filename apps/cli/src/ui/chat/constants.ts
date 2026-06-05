export const ACCENT = "#a16207";
export const META_ACCENT = "#0e7490";
/** Secondary accent for right-pane chrome (e.g. detail title bar when focused). */
export const SECONDARY_ACCENT = "#2563eb";
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

/** Label prefix for the rotating tip on the input hint line. */
export const TIP_LABEL = "Tip: ";
/** Rotating tips shown on the input hint line in chat sessions. */
export const TIPS = [
	'Type "/" to see a list of commands you can run.',
	'Type "/config" to open the configuration settings.',
	"Associate integrations with organization tools (e.g. Gmail \u2194 E-Mail, Apple Calendar \u2194 Calendar) in the configuration view.",
	'Type "/scope" to change which integrations are active for the current session.',
	'Type "/help" or press "?" with an empty prompt for slash commands and shortcuts.',
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
