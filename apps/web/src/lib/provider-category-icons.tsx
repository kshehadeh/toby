import type { LucideIcon } from "lucide-react";
import {
	Briefcase,
	CalendarDays,
	Contact,
	Kanban,
	ListTodo,
	Mail,
	MessageSquare,
	Search,
} from "lucide-react";

const PROVIDER_CATEGORY_ICONS: Record<string, LucideIcon> = {
	email: Mail,
	calendar: CalendarDays,
	tasks: ListTodo,
	contacts: Contact,
	chat: MessageSquare,
	search: Search,
	work_tracker: Kanban,
};

export function getProviderCategoryIcon(key: string): LucideIcon {
	const category = key.startsWith("defaults.")
		? key.slice("defaults.".length)
		: key;
	return PROVIDER_CATEGORY_ICONS[category] ?? Briefcase;
}
