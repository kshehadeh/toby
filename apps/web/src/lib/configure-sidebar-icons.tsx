import type { LucideIcon } from "lucide-react";
import {
	CalendarClock,
	Mic,
	MessageSquare,
	Plug,
	SlidersHorizontal,
	Sparkles,
	Users,
	Wand2,
} from "lucide-react";

const TOP_LEVEL_SECTION_ICONS: Record<string, LucideIcon> = {
	integrations: Plug,
	chatInbound: MessageSquare,
	defaults: SlidersHorizontal,
	ai: Sparkles,
	personas: Users,
	skills: Wand2,
	listen: Mic,
	schedules: CalendarClock,
};

export function getSidebarSectionIcon(
	key: string,
	depth: number,
): LucideIcon | null {
	if (depth !== 0) return null;
	return TOP_LEVEL_SECTION_ICONS[key] ?? null;
}
