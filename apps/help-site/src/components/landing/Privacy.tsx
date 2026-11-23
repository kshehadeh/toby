import {
	HardDrive,
	KeyRound,
	type LucideIcon,
	SlidersHorizontal,
	Sparkles,
} from "lucide-react";
import Link from "next/link";
import { ButtonLink } from "../Button";
import { DownloadTobyButton } from "../DownloadTobyButton";
import { Container, SectionHeading, TextLink, delay } from "./primitives";

type Point = {
	readonly icon: LucideIcon;
	readonly title: string;
	readonly body: string;
};

const privacy: readonly Point[] = [
	{
		icon: HardDrive,
		title: "Stored on your Mac",
		body: "Settings, chats, memories, and recordings stay on your computer. There is no Toby cloud.",
	},
	{
		icon: KeyRound,
		title: "Secrets in your Keychain",
		body: "Your AI key, mail passwords, and Slack tokens live in the macOS Keychain. Backups are encrypted.",
	},
	{
		icon: Sparkles,
		title: "One AI account",
		body: "Sign in with OpenRouter once and use models from OpenAI, Anthropic, Google, and more.",
	},
	{
		icon: SlidersHorizontal,
		title: "Only what you connect",
		body: "Toby reaches only the apps you connect, and you can disconnect any of them at any time.",
	},
];

function PointGrid({
	points,
}: { readonly points: readonly (Point & { href?: string })[] }) {
	return (
		<div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
			{points.map(({ icon: Icon, title, body, href }, i) => {
				const content = (
					<>
						<Icon aria-hidden size={18} className="text-fg" strokeWidth={1.8} />
						<h3 className="mt-5 text-[0.9375rem] font-semibold text-fg">
							{title}
						</h3>
						<p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
					</>
				);
				const className =
					"block h-full bg-surface p-6 transition-colors duration-150";
				return (
					<div key={title} data-reveal style={delay(i * 70)}>
						{href ? (
							<Link
								href={href}
								className={`${className} hover:bg-surface-hover`}
							>
								{content}
							</Link>
						) : (
							<div className={className}>{content}</div>
						)}
					</div>
				);
			})}
		</div>
	);
}

export function Privacy() {
	return (
		<section
			id="privacy"
			className="scroll-mt-navbar border-t border-line-subtle py-24 sm:py-32"
		>
			<Container>
				<SectionHeading
					eyebrow="Privacy"
					title="Your data stays on your Mac"
					lead="Toby is a native app, not a web service. You decide which apps it can reach."
				/>
				<PointGrid points={privacy} />
				<div className="mt-8">
					<TextLink href="/docs/security">How Toby protects your data</TextLink>
				</div>
			</Container>
		</section>
	);
}

export function ClosingCta() {
	return (
		<section className="relative overflow-hidden border-t border-line-subtle py-28 sm:py-36">
			<div
				aria-hidden
				className="glow-accent pointer-events-none absolute bottom-[-220px] left-1/2 h-[440px] w-[900px] max-w-full -translate-x-1/2 blur-3xl"
			/>
			<Container className="relative text-center">
				<div data-reveal>
					<img
						src="/img/256x256.png"
						alt=""
						width={72}
						height={72}
						className="mx-auto mb-8 size-[72px]"
					/>
					<h2 className="text-gradient text-display-lg font-semibold">
						Start with one question
					</h2>
					<p className="mx-auto mt-5 max-w-md text-[1.0625rem] text-muted">
						Setup takes about ten minutes. Connect an AI provider and one app,
						then ask what needs you today.
					</p>
					<div className="mt-9 flex flex-wrap items-center justify-center gap-3">
						<DownloadTobyButton size="lg" />
						<ButtonLink
							href="/docs/getting-started/install"
							variant="ghost"
							size="lg"
						>
							Installation guide
						</ButtonLink>
					</div>
				</div>
			</Container>
		</section>
	);
}
