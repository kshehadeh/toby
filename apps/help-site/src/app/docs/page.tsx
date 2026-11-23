import { DownloadTobyButton } from "@/components/DownloadTobyButton";
import {
	AppWindow,
	Blocks,
	Code,
	type LucideIcon,
	Mic,
	Rocket,
	Settings2,
	ShieldCheck,
	Sparkles,
	Wand2,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "Documentation",
	description:
		"Guides for installing, setting up, and getting the most out of Toby.",
	alternates: { canonical: "/docs" },
};

type Section = {
	readonly icon: LucideIcon;
	readonly title: string;
	readonly description: string;
	readonly href: string;
};

const sections: readonly Section[] = [
	{
		icon: Rocket,
		title: "Getting started",
		description:
			"Install Toby, connect an AI provider and your apps, and have your first chat.",
		href: "/docs/getting-started/install",
	},
	{
		icon: Wand2,
		title: "Things to try",
		description:
			"Copy-and-paste ideas for your inbox, calendar, meetings, and weekly routines.",
		href: "/docs/examples",
	},
	{
		icon: AppWindow,
		title: "Toby app tour",
		description: "Find your way around Home, Chats, Projects, and Settings.",
		href: "/docs/toby-app",
	},
	{
		icon: Blocks,
		title: "Integrations",
		description:
			"Email, Apple Calendar, Reminders, Contacts, Todoist, Slack, Notion, Jira, and more.",
		href: "/docs/integrations/overview",
	},
	{
		icon: Mic,
		title: "Recordings",
		description:
			"Record meetings and calls, then get transcripts, summaries, and action items.",
		href: "/docs/listen",
	},
	{
		icon: Sparkles,
		title: "AI (OpenRouter)",
		description:
			"Sign in once and use models from OpenAI, Anthropic, Google, and more.",
		href: "/docs/ai-providers/openrouter",
	},
	{
		icon: Settings2,
		title: "Settings",
		description:
			"Account, sources, recordings, chat replies, sync, and backups.",
		href: "/docs/configuration/overview",
	},
	{
		icon: ShieldCheck,
		title: "Security & privacy",
		description:
			"Where your data lives, how passwords are protected, and backups.",
		href: "/docs/security",
	},
	{
		icon: Code,
		title: "How Toby works",
		description: "One native Mac app: what runs where and what Toby talks to.",
		href: "/docs/architecture/overview",
	},
];

export default function DocsIndex() {
	return (
		<div className="mx-auto w-full max-w-[960px] px-4 pt-10 pb-20 sm:px-8 lg:pt-14">
			<h1 className="text-gradient text-display-md font-semibold">
				Documentation
			</h1>
			<p className="mt-4 max-w-xl text-[1.0625rem] leading-relaxed text-muted">
				Toby is an AI assistant for your Mac. New here? Start with{" "}
				<Link
					href="/docs/intro"
					className="text-fg underline decoration-line-strong underline-offset-[3px] transition-colors hover:text-accent hover:decoration-accent"
				>
					Welcome to Toby
				</Link>
				, then install it.
			</p>
			<div className="mt-7">
				<DownloadTobyButton size="md" />
			</div>
			<div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
				{sections.map(({ icon: Icon, title, description, href }) => (
					<Link
						key={title}
						href={href}
						className="group block bg-surface p-6 transition-colors duration-150 hover:bg-surface-hover"
					>
						<Icon
							aria-hidden
							size={18}
							strokeWidth={1.8}
							className="text-faint transition-colors group-hover:text-accent"
						/>
						<span className="mt-4 block text-[0.9375rem] font-semibold text-fg">
							{title}
						</span>
						<p className="mt-1.5 text-sm leading-relaxed text-muted">
							{description}
						</p>
					</Link>
				))}
			</div>
		</div>
	);
}
