import Link from "@docusaurus/Link";
import useBaseUrl from "@docusaurus/useBaseUrl";
import Layout from "@theme/Layout";
import type React from "react";
import DownloadTobyButton from "../components/DownloadTobyButton";
import styles from "./index.module.css";

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

export default function Home(): React.JSX.Element {
	const logoUrl = useBaseUrl("/img/256x256.png");

	return (
		<Layout title="Toby documentation" description="Documentation for Toby.">
			<main className={styles.page}>
				<img
					src={logoUrl}
					alt="Toby logo"
					className={styles.logo}
					width={128}
					height={128}
				/>
				<span className={styles.eyebrow}>Documentation</span>
				<h1 className={styles.title}>Toby Documentation</h1>
				<p className={styles.lead}>
					Toby is an AI assistant for your Mac. It connects to your email,
					calendar, tasks, and other apps so you can ask for help in plain
					English, record and summarize meetings, and put routine work on
					autopilot.
				</p>
				<p className={styles.lead}>
					New here? Start with <Link to="/docs/intro">Welcome to Toby</Link>,
					then install it below.
				</p>
				<div className={styles.actions}>
					<DownloadTobyButton />
					<Link
						to="/docs/getting-started/install"
						className={styles.secondaryAction}
					>
						Installation guide →
					</Link>
				</div>
				<a
					className={styles.betaListBadge}
					target="_blank"
					rel="noopener noreferrer"
					href="https://betalist.com/startups/toby?utm_campaign=badge-toby&utm_medium=badge&utm_source=badge-featured"
				>
					<img
						alt="Toby - Organize and summarize work across Email, Todoist, Slack, Jira, and Calendr | BetaList"
						width={156}
						height={54}
						src="https://betalist.com/badges/featured?id=180938&theme=dark"
					/>
				</a>
				<div className={styles.grid}>
					{sections.map((section) => (
						<Link key={section.title} to={section.to} className={styles.card}>
							<span className={styles.cardTitle}>{section.title}</span>
							<p className={styles.cardDesc}>{section.description}</p>
						</Link>
					))}
				</div>
			</main>
		</Layout>
	);
}
