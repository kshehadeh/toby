import {
	BatteryMedium,
	Bluetooth,
	type LucideIcon,
	Volume2,
	Wifi,
	Workflow,
} from "lucide-react";
import type { ReactNode } from "react";
import { SpotlightCard } from "./SpotlightCard";
import { Container, SectionHeading, delay } from "./primitives";

function TileText({
	title,
	body,
}: { readonly title: string; readonly body: string }) {
	return (
		<div className="p-6 sm:p-7">
			<h3 className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-fg">
				{title}
			</h3>
			<p className="mt-2 max-w-md text-sm leading-relaxed text-muted">{body}</p>
		</div>
	);
}

function TileImage({
	src,
	alt,
}: { readonly src: string; readonly alt: string }) {
	return (
		<div className="mask-fade-b mt-auto h-60 overflow-hidden pl-6 sm:pl-7">
			<img
				src={src}
				alt={alt}
				loading="lazy"
				decoding="async"
				className="block h-[120%] w-full rounded-tl-lg border-t border-l border-line-strong object-cover object-top-left transition-transform duration-500 group-hover:-translate-y-1 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0"
			/>
		</div>
	);
}

const waveform = [
	6, 14, 22, 12, 28, 18, 34, 20, 10, 26, 38, 22, 14, 30, 16, 8, 24, 32, 18, 12,
	26, 20, 10, 16, 28, 14, 6, 18, 24, 12,
];

/** Stylized recording summary (no real transcript content). */
function RecordingMock() {
	return (
		<div aria-hidden className="mt-auto px-6 pb-7 sm:px-7">
			<div className="rounded-xl border border-line bg-canvas/60 p-4">
				<div className="mb-3 flex items-center gap-2 text-xs text-faint">
					<span className="size-2 rounded-full bg-red-500" />
					Weekly sync · 32 min
				</div>
				<div className="flex h-10 items-center gap-[3px]">
					{waveform.map((h, i) => (
						<span
							// biome-ignore lint/suspicious/noArrayIndexKey: static decorative bars
							key={i}
							className="w-full rounded-full bg-white/20 transition-colors group-hover:bg-accent/70"
							style={{ height: `${h}px` }}
						/>
					))}
				</div>
				<div className="mt-4 text-xs font-medium text-fg">Action items</div>
				<ul className="mt-2 flex flex-col gap-1.5 text-xs text-muted">
					{[
						"Send revised timeline to design",
						"Book the launch review for Thursday",
						"Draft release notes",
					].map((item) => (
						<li key={item} className="flex items-center gap-2">
							<span className="size-3 shrink-0 rounded-[4px] border border-line-strong" />
							{item}
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}

const macControls: readonly { icon: LucideIcon; label: string }[] = [
	{ icon: Wifi, label: "Wi‑Fi" },
	{ icon: Bluetooth, label: "Bluetooth" },
	{ icon: Volume2, label: "Volume" },
	{ icon: BatteryMedium, label: "Battery" },
	{ icon: Workflow, label: "Shortcuts" },
];

type Tile = {
	readonly title: string;
	readonly body: string;
	readonly href: string;
	readonly span: string;
	readonly visual: ReactNode;
};

const tiles: readonly Tile[] = [
	{
		title: "Ask in plain English",
		body: "Summarize, search, draft replies, and create events across every app you connect, all in one answer.",
		href: "/docs/getting-started/first-chat",
		span: "md:col-span-4",
		visual: (
			<TileImage
				src="/img/landing/chat.png"
				alt="A new Toby chat with suggested prompts"
			/>
		),
	},
	{
		title: "Meetings, written up",
		body: "Record your mic and call audio, then get a transcript, summary, and action items.",
		href: "/docs/listen",
		span: "md:col-span-2",
		visual: <RecordingMock />,
	},
	{
		title: "Routine work on autopilot",
		body: "Flows run on a schedule, a shortcut, or an event, so the weekly recap writes itself.",
		href: "/docs/flows",
		span: "md:col-span-2",
		visual: <TileImage src="/img/landing/flows.png" alt="A flow's steps" />,
	},
	{
		title: "Remembers what matters",
		body: "Tell Toby a preference once and it carries into every future chat.",
		href: "/docs/memories",
		span: "md:col-span-2",
		visual: <TileImage src="/img/landing/memories.png" alt="Saved memories" />,
	},
	{
		title: "Projects keep work together",
		body: "Group chats, files, and instructions for a piece of work in one place.",
		href: "/docs/projects",
		span: "md:col-span-2",
		visual: <TileImage src="/img/landing/projects.png" alt="A project" />,
	},
	{
		title: "A library Toby can read",
		body: "Add PDFs, documents, and images once, and Toby can cite them in any chat.",
		href: "/docs/library",
		span: "md:col-span-3",
		visual: <TileImage src="/img/landing/library.png" alt="The file library" />,
	},
	{
		title: "Control your Mac",
		body: "Toggle Wi‑Fi or Bluetooth, change the volume, check the battery, or run a Shortcut, all by asking.",
		href: "/docs/integrations/macos",
		span: "md:col-span-3",
		visual: (
			<ul className="mt-auto flex flex-wrap gap-2 px-6 pb-7 sm:px-7">
				{macControls.map(({ icon: Icon, label }) => (
					<li
						key={label}
						className="inline-flex items-center gap-2 rounded-lg border border-line bg-white/[0.03] px-3 py-2 text-[0.8125rem] text-muted transition-colors group-hover:border-line-strong group-hover:text-fg"
					>
						<Icon aria-hidden size={15} />
						{label}
					</li>
				))}
			</ul>
		),
	},
];

export function Features() {
	return (
		<section id="features" className="scroll-mt-navbar py-24 sm:py-32">
			<Container>
				<SectionHeading
					eyebrow="Features"
					title="Everything your day touches, in one place"
					lead="Toby is one assistant across your inbox, calendar, meetings, and files, built as a native Mac app."
				/>
				<div className="grid grid-cols-1 gap-4 md:grid-cols-6">
					{tiles.map((tile, i) => (
						<div
							key={tile.title}
							data-reveal
							style={delay((i % 3) * 80)}
							className={`flex ${tile.span}`}
						>
							<SpotlightCard href={tile.href} className="w-full">
								<TileText title={tile.title} body={tile.body} />
								{tile.visual}
							</SpotlightCard>
						</div>
					))}
				</div>
			</Container>
		</section>
	);
}
