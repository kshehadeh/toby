import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { ButtonLink } from "../Button";
import { DownloadTobyButton } from "../DownloadTobyButton";
import { Container, Screenshot, delay } from "./primitives";

export function Hero() {
	return (
		<section className="relative overflow-hidden pt-20 pb-10 sm:pt-28">
			<div
				aria-hidden
				className="bg-grid mask-fade-b pointer-events-none absolute inset-x-0 top-0 h-[640px] opacity-60"
			/>
			<Container className="relative">
				<div className="mx-auto max-w-3xl text-center">
					<Link
						href="/docs/flows"
						data-reveal
						className="mb-8 inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.03] py-1 pr-3 pl-1 text-[0.8125rem] text-muted transition-colors hover:border-line-strong hover:text-fg"
					>
						<span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
							New
						</span>
						Flows that run on a schedule or a shortcut
						<ArrowRight aria-hidden size={13} />
					</Link>
					<h1
						data-reveal
						style={delay(60)}
						className="text-gradient text-display-xl font-semibold"
					>
						Your Mac’s AI assistant, wired into your day
					</h1>
					<p
						data-reveal
						style={delay(120)}
						className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted"
					>
						Toby connects to your email, calendar, tasks, and team tools. Ask
						for help in plain English, get meetings written up, and put routine
						work on autopilot.
					</p>
					<div
						data-reveal
						style={delay(180)}
						className="mt-9 flex flex-wrap items-center justify-center gap-3"
					>
						<DownloadTobyButton size="lg" />
						<ButtonLink href="/docs/intro" variant="secondary" size="lg">
							Read the docs
						</ButtonLink>
					</div>
					<p data-reveal style={delay(220)} className="mt-4 text-xs text-faint">
						Requires macOS 26 or later on Apple silicon
					</p>
				</div>

				<div className="relative mx-auto mt-16 max-w-[1080px] sm:mt-20">
					<div
						aria-hidden
						className="glow-accent pointer-events-none absolute -top-24 left-1/2 h-[420px] w-[80%] -translate-x-1/2 blur-2xl"
					/>
					<div className="hero-shot relative [mask-image:linear-gradient(to_bottom,#000_72%,transparent)]">
						<Screenshot
							src="/img/landing/hero.png"
							alt="Toby triaging the unread email that needs a reply"
							priority
						/>
					</div>
				</div>
			</Container>
		</section>
	);
}
