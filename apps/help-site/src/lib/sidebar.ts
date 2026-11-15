/**
 * Sidebar is grouped by what the reader is trying to do (start, use, connect,
 * configure, build) rather than by folder, so beginners see the essentials
 * first and developer material sits at the end. Doc URLs come from file paths
 * (`docs/<id>.mdx` → `/docs/<id>`) and are unaffected by this grouping.
 *
 * Items are doc ids (strings) or categories. A category's `link` makes its
 * label navigate to that doc; categories start collapsed unless they contain
 * the current page.
 */

export type SidebarIcon =
	| "rocket"
	| "app"
	| "blocks"
	| "sparkles"
	| "settings"
	| "code"
	| "message";

export type SidebarCategory = {
	readonly type: "category";
	readonly label: string;
	readonly link?: string;
	readonly icon?: SidebarIcon;
	readonly items: readonly SidebarItem[];
};

export type SidebarItem = string | SidebarCategory;

export const sidebar: readonly SidebarItem[] = [
	"intro",
	{
		type: "category",
		label: "Getting Started",
		link: "getting-started/install",
		icon: "rocket",
		items: [
			"getting-started/setup-ai",
			"getting-started/configure-and-status",
			"getting-started/first-chat",
		],
	},
	"examples",
	{
		type: "category",
		label: "Using Toby",
		link: "toby-app",
		icon: "app",
		items: [
			"personas",
			"skills",
			"memories",
			"projects",
			"library",
			"listen",
			"schedules",
			"flows",
		],
	},
	{
		type: "category",
		label: "Integrations",
		link: "integrations/overview",
		icon: "blocks",
		items: [
			"integrations/email",
			"integrations/apple-calendar",
			"integrations/apple-reminders",
			"integrations/apple-contacts",
			"integrations/macos",
			"integrations/todoist",
			"integrations/slack",
			"integrations/notion",
			"integrations/jira",
			"integrations/news",
			"integrations/mcp",
			"chat-surfaces/overview",
		],
	},
	{
		type: "category",
		label: "AI Providers",
		link: "ai-providers/overview",
		icon: "sparkles",
		items: [
			"ai-providers/vercel-ai-gateway",
			"ai-providers/openrouter",
			"ai-providers/openai",
			"ai-providers/chutes",
			"ai-providers/ollama",
		],
	},
	{
		type: "category",
		label: "Settings",
		link: "configuration/overview",
		icon: "settings",
		items: [
			"configuration/default-providers",
			"configuration/web-search",
			"configuration/weather",
			"configuration/location",
			"configuration/transcription",
			"configuration/inbound-chat",
			"configuration/icloud-sync",
		],
	},
	"security",
	{
		type: "category",
		label: "For Developers",
		icon: "code",
		items: [
			"plugins/creating-a-plugin",
			{
				type: "category",
				label: "Local APIs",
				link: "api/overview",
				items: ["api/server-api", "api/native-api"],
			},
			"architecture/overview",
		],
	},
];
