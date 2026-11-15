import { Check } from "lucide-react";
import { Container, Eyebrow, Screenshot, TextLink } from "./primitives";

type Walkthrough = {
	readonly eyebrow: string;
	readonly title: string;
	readonly body: string;
	readonly points: readonly string[];
	readonly href: string;
	readonly linkLabel: string;
	readonly image: string;
	readonly alt: string;
};

const items: readonly Walkthrough[] = [
	{
		eyebrow: "Chat",
		title: "A morning briefing in one answer",
		body: "Ask what today looks like and Toby pulls your mail, calendar, and tasks together, then calls out what needs you first.",
		points: [
			"One answer across every connected app",
			"Flags what needs a reply or prep",
			"Make it a daily flow so it’s waiting for you",
		],
		href: "/docs/examples",
		linkLabel: "See things to try",
		image: "/img/landing/briefing.png",
		alt: "A Toby chat with a morning briefing",
	},
	{
		eyebrow: "Flows",
		title: "Build it once, and it keeps running",
		body: "Chain tools and AI steps into a flow, then run it by hand, on a schedule, or from a keyboard shortcut.",
		points: [
			"Run every morning, every Monday, or month-end",
			"Mix app actions with AI summaries and drafts",
			"Start the built-in flows or write your own",
		],
		href: "/docs/flows",
		linkLabel: "Learn about Flows",
		image: "/img/landing/flow-detail.png",
		alt: "A Toby flow and how it works",
	},
];

export function Walkthroughs() {
	return (
		<section className="border-t border-line-subtle py-24 sm:py-32">
			<Container className="flex flex-col gap-28">
				{items.map((item, i) => (
					<div
						key={item.title}
						className="grid items-center gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16"
					>
						<div data-reveal className={i % 2 === 1 ? "lg:order-2" : ""}>
							<Eyebrow>{item.eyebrow}</Eyebrow>
							<h2 className="text-gradient text-display-md font-semibold">
								{item.title}
							</h2>
							<p className="mt-4 text-[1.0625rem] leading-relaxed text-muted">
								{item.body}
							</p>
							<ul className="mt-6 flex flex-col gap-2.5">
								{item.points.map((point) => (
									<li
										key={point}
										className="flex items-start gap-2.5 text-sm text-muted"
									>
										<Check
											aria-hidden
											size={16}
											className="mt-0.5 shrink-0 text-accent"
										/>
										{point}
									</li>
								))}
							</ul>
							<div className="mt-7">
								<TextLink href={item.href}>{item.linkLabel}</TextLink>
							</div>
						</div>
						<div data-reveal className="relative">
							<div
								aria-hidden
								className="glow-accent pointer-events-none absolute inset-0 -z-10 scale-90 opacity-40 blur-3xl"
							/>
							<Screenshot src={item.image} alt={item.alt} />
						</div>
					</div>
				))}
			</Container>
		</section>
	);
}
