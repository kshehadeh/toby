import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

/**
 * Sidebar is grouped by what the reader is trying to do (start, use, connect,
 * configure, build) rather than by folder, so beginners see the essentials
 * first and developer material sits at the end. Doc URLs come from file paths
 * and are unaffected by this grouping.
 */
const sidebars: SidebarsConfig = {
	helpSidebar: [
		"intro",
		{
			type: "category",
			label: "Getting Started",
			link: { type: "doc", id: "getting-started/install" },
			customProps: { icon: "rocket" },
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
			link: { type: "doc", id: "toby-app" },
			customProps: { icon: "app" },
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
			link: { type: "doc", id: "integrations/overview" },
			customProps: { icon: "blocks" },
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
			link: { type: "doc", id: "ai-providers/overview" },
			customProps: { icon: "sparkles" },
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
			link: { type: "doc", id: "configuration/overview" },
			customProps: { icon: "settings" },
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
			customProps: { icon: "code" },
			collapsed: true,
			items: [
				"plugins/creating-a-plugin",
				{
					type: "category",
					label: "Local APIs",
					link: { type: "doc", id: "api/overview" },
					items: ["api/server-api", "api/native-api"],
				},
				"architecture/overview",
			],
		},
	],
};

export default sidebars;
