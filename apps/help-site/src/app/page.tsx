import { DownloadTobyButton } from "@/components/DownloadTobyButton";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "Toby documentation",
	description: "Documentation for Toby.",
};

const sections = [
	{
		title: "Welcome to Toby",
		description: "What Toby is, who it's for, and what it can do for your day.",
		to: "/docs/intro",
	},
	{
		title: "Getting Started",
		description:
			"Install Toby, connect an AI provider and your apps, and have your first chat.",
		to: "/docs/getting-started/install",
	},
	{
		title: "Things to try",
		description:
			"Copy-and-paste ideas for your inbox, calendar, meetings, and weekly routines.",
		to: "/docs/examples",
	},
	{
		title: "Toby app tour",
		description: "Find your way around Home, Chats, Projects, and Settings.",
		to: "/docs/toby-app",
	},
	{
		title: "Integrations",
		description:
			"Email, Apple Calendar, Reminders, Contacts, Todoist, Slack, Notion, Jira, and more.",
		to: "/docs/integrations/overview",
	},
	{
		title: "Recordings",
		description:
			"Record meetings and calls, then get transcripts, summaries, and action items.",
		to: "/docs/listen",
	},
	{
		title: "Schedules",
		description:
			"Have Toby do routine work automatically, every morning or every week.",
		to: "/docs/schedules",
	},
	{
		title: "Memories",
		description: "Teach Toby your preferences once and it remembers them.",
		to: "/docs/memories",
	},
	{
		title: "Security & privacy",
		description:
			"Where your data lives, how passwords are protected, and backups.",
		to: "/docs/security",
	},
];

const lead = "mb-3 max-w-xl text-[1.0625rem] leading-[1.65] text-muted";

export default function Home() {
	return (
		<main className="mx-auto w-full max-w-[642px] px-6 pt-14 pb-16">
			<img
				src="/img/256x256.png"
				alt="Toby logo"
				width={128}
				height={128}
				className="mb-5 block size-32"
			/>
			<span className="mb-3 inline-block text-xs font-semibold uppercase tracking-[0.06em] text-accent">
				Documentation
			</span>
			<h1 className="mb-4 text-[2.5rem] font-bold leading-[1.15] tracking-[-0.03em] text-fg">
				Toby Documentation
			</h1>
			<p className={lead}>
				Toby is an AI assistant for your Mac. It connects to your email,
				calendar, tasks, and other apps so you can ask for help in plain
				English, record and summarize meetings, and put routine work on
				autopilot.
			</p>
			<p className={lead}>
				New here? Start with{" "}
				<Link
					href="/docs/intro"
					className="text-fg underline decoration-[#404040] underline-offset-[3px] hover:text-accent hover:decoration-accent"
				>
					Welcome to Toby
				</Link>
				, then install it below.
			</p>
			<div className="mt-6 mb-2 flex flex-wrap items-center gap-x-5 gap-y-3.5">
				<DownloadTobyButton />
				<Link
					href="/docs/getting-started/install"
					className="text-[0.9375rem] font-medium text-muted transition-colors hover:text-accent"
				>
					Installation guide →
				</Link>
			</div>
			<div className="mt-5 flex flex-wrap items-center gap-4 [&_a]:inline-block [&_a]:leading-none">
				<a
					target="_blank"
					rel="noopener noreferrer"
					href="https://betalist.com/startups/toby?utm_campaign=badge-toby&utm_medium=badge&utm_source=badge-featured"
				>
					<img
						alt="Toby - Organize and summarize work across Email, Todoist, Slack, Jira, and Calendr | BetaList"
						width={156}
						height={54}
						className="block h-[54px] w-[156px]"
						src="https://betalist.com/badges/featured?id=180938&theme=dark"
					/>
				</a>
				<a
					href="https://buildlist.io"
					target="_blank"
					rel="noopener noreferrer"
				>
					<img
						src="https://buildlist.io/badge.svg"
						alt="Featured on Buildlist"
						className="h-10 w-auto"
					/>
				</a>
			</div>
			<div className="mt-10 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
				{sections.map((section) => (
					<Link
						key={section.title}
						href={section.to}
						className="block rounded-lg border border-line bg-surface px-[1.35rem] py-5 transition-colors duration-150 hover:border-[#404040] hover:bg-surface-hover"
					>
						<span className="mb-1.5 block text-[0.9375rem] font-semibold text-fg">
							{section.title}
						</span>
						<p className="m-0 text-sm leading-normal text-muted">
							{section.description}
						</p>
					</Link>
				))}
			</div>
		</main>
	);
}
