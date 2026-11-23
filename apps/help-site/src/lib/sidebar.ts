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
			"todos",
			"followups",
			"projects",
			"library",
			"listen",
			"schedules",
			"flows",
		],
	},
	{
		type: "category",
		label: "Sources",
		link: "integrations/overview",
		icon: "blocks",
		items: [
			"integrations/email",
			"integrations/slack",
			"integrations/apple-calendar",
			"integrations/apple-reminders",
			"integrations/apple-contacts",
			"integrations/macos",
		],
	},
	{
		type: "category",
		label: "Settings",
		link: "configuration/overview",
		icon: "settings",
		items: [
			"ai-providers/openrouter",
			"configuration/transcription",
			"configuration/inbound-chat",
			"configuration/icloud-sync",
			"configuration/location",
		],
	},
	"security",
	"architecture/overview",
];
