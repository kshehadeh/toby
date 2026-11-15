import {
	Flame,
	Info,
	Lightbulb,
	type LucideIcon,
	TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";

type CalloutType = "note" | "tip" | "info" | "warning" | "caution" | "danger";

const styles: Record<
	CalloutType,
	{ box: string; heading: string; icon: LucideIcon }
> = {
	note: {
		box: "border-neutral-500 bg-[#474748]/40",
		heading: "text-[#fdfdfe]",
		icon: Info,
	},
	tip: {
		box: "border-[#009400] bg-[#003100]",
		heading: "text-[#e6f6e6]",
		icon: Lightbulb,
	},
	info: {
		box: "border-line bg-surface-raised",
		heading: "text-muted",
		icon: Info,
	},
	warning: {
		box: "border-[#e6a700] bg-[#4d3800]",
		heading: "text-[#fff8e6]",
		icon: TriangleAlert,
	},
	caution: {
		box: "border-[#e6a700] bg-[#4d3800]",
		heading: "text-[#fff8e6]",
		icon: TriangleAlert,
	},
	danger: {
		box: "border-[#fa383e] bg-[#4b1113]",
		heading: "text-[#ffebec]",
		icon: Flame,
	},
};

type CalloutProps = {
	readonly type?: CalloutType;
	/** Defaults to the type name (rendered uppercase), like Docusaurus admonitions. */
	readonly title?: string;
	readonly children: ReactNode;
};

/**
 * Admonition box. Replaces Docusaurus `:::tip[Title]` syntax:
 *
 * ```mdx
 * <Callout type="tip" title="Ask for a draft first">
 *
 * Body **markdown**.
 *
 * </Callout>
 * ```
 */
export function Callout({ type = "note", title, children }: CalloutProps) {
	const style = styles[type];
	const Icon = style.icon;
	return (
		<div className={`mb-5 rounded-lg border p-4 ${style.box}`}>
			<div
				className={`mb-1.5 flex items-center gap-1.5 text-sm font-bold uppercase leading-tight ${style.heading}`}
			>
				<Icon aria-hidden size={20} strokeWidth={2} />
				{title ?? type}
			</div>
			<div className="[&>*:last-child]:mb-0">{children}</div>
		</div>
	);
}
