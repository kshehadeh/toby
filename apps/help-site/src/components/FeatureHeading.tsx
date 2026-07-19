import type { LucideIcon } from "lucide-react";
import {
	AppWindow,
	Apple,
	ArrowRight,
	Bot,
	CalendarClock,
	GitBranch,
	MessageSquare,
	Mic,
	Settings2,
	UserRound,
} from "lucide-react";
import type React from "react";

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

type FeatureIcon = keyof typeof icons;

type FeatureTone =
	| "ai"
	| "mic"
	| "chat"
	| "macos"
	| "schedule"
	| "config"
	| "persona"
	| "next";

type FeatureHeadingProps = {
	readonly icon: FeatureIcon;
	readonly title: string;
	readonly tone?: FeatureTone;
};

const toneClassName: Record<FeatureTone, string> = {
	ai: "featureHeadingIconAi",
	mic: "featureHeadingIconMic",
	chat: "featureHeadingIconChat",
	macos: "featureHeadingIconMacos",
	schedule: "featureHeadingIconSchedule",
	config: "featureHeadingIconConfig",
	persona: "featureHeadingIconPersona",
	next: "featureHeadingIconNext",
};

export default function FeatureHeading({
	icon,
	title,
	tone,
}: FeatureHeadingProps): React.JSX.Element {
	const Icon = icons[icon];
	const toneClass = tone ? toneClassName[tone] : undefined;

	return (
		<h2 className="featureHeading">
			<span
				className={
					toneClass ? `featureHeadingIcon ${toneClass}` : "featureHeadingIcon"
				}
				aria-hidden="true"
			>
				<Icon size={18} strokeWidth={2.1} />
			</span>
			{title}
		</h2>
	);
}
