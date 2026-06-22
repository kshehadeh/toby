import Link from "@docusaurus/Link";
import useBaseUrl from "@docusaurus/useBaseUrl";
import Layout from "@theme/Layout";
import type React from "react";
import styles from "./index.module.css";

const sections = [
	{
		title: "What Does Toby Do?",
		description:
			"AI support, audio transcription, chat integrations, macOS control, schedules, and personas.",
		to: "/docs/what-does-toby-do",
	},
	{
		title: "Getting Started",
		description:
			"Install Toby, set up AI, connect integrations, and start chatting.",
		to: "/docs/getting-started/install",
	},
	{
		title: "Integrations",
		description: "Gmail, Todoist, Slack, Azure AD, and Apple Calendar.",
		to: "/docs/integrations/overview",
	},
	{
		title: "Personas",
		description: "Shape how Toby prioritizes and responds.",
		to: "/docs/personas",
	},
	{
		title: "Skills",
		description: "Reusable task instructions Toby applies when relevant.",
		to: "/docs/skills",
	},
	{
		title: "Memories",
		description: "Durable context Toby remembers across sessions.",
		to: "/docs/memories",
	},
	{
		title: "Schedules",
		description: "Recurring prompts that run on a cron timetable.",
		to: "/docs/schedules",
	},
	{
		title: "Examples",
		description: "Real-world workflows combining Toby features.",
		to: "/docs/examples",
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
					Toby is an AI assistant for organizing and summarizing work across
					Gmail, Todoist, Slack, Azure AD, and Apple Calendar. Chat from the
					terminal, a local web UI, or the native macOS app.
				</p>
				<p className={styles.lead}>
					New here? Read{" "}
					<Link to="/docs/what-does-toby-do">What Does Toby Do?</Link>, then{" "}
					<Link to="/docs/getting-started/install">install Toby</Link>.
				</p>
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
