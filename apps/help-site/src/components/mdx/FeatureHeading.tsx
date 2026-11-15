import {
	AppWindow,
	Apple,
	ArrowRight,
	Bot,
	CalendarClock,
	GitBranch,
	type LucideIcon,
	MessageSquare,
	Mic,
	Settings2,
	UserRound,
} from "lucide-react";

const icons = {
	app: AppWindow,
	bot: Bot,
	mic: Mic,
	message: MessageSquare,
	apple: Apple,
	schedule: CalendarClock,
	workflow: GitBranch,
	config: Settings2,
	persona: UserRound,
	next: ArrowRight,
} as const satisfies Record<string, LucideIcon>;

const tones = {
	ai: "bg-linear-135 from-[#10a37f] to-[#1a7f64]",
	mic: "bg-linear-135 from-[#ef4444] to-[#b91c1c]",
	chat: "bg-[linear-gradient(135deg,#36c5f0,#2eb67d_45%,#ecb22e_70%,#e01e5a)]",
	macos: "bg-linear-135 from-[#737373] to-[#404040]",
	schedule: "bg-linear-135 from-[#6366f1] to-[#4338ca]",
	config: "bg-linear-135 from-[#525252] to-[#262626]",
	persona: "bg-linear-135 from-accent to-accent-dim",
	next: "bg-linear-135 from-[#0ea5e9] to-[#0284c7]",
} as const;

type FeatureHeadingProps = {
	readonly icon: keyof typeof icons;
	readonly title: string;
	readonly tone?: keyof typeof tones;
};

/** Section heading with a round, tinted icon badge (feature pages). */
export function FeatureHeading({ icon, title, tone }: FeatureHeadingProps) {
	const Icon = icons[icon];
	return (
		<h2 className="mt-12 mb-4 flex items-center gap-3 text-[1.5rem] font-semibold leading-tight tracking-[-0.025em] text-fg">
			<span
				aria-hidden="true"
				className={`inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-line-subtle text-white ${
					tone ? tones[tone] : "bg-white/4"
				}`}
			>
				<Icon className="size-[1.15rem]" strokeWidth={2.1} />
			</span>
			{title}
		</h2>
	);
}
