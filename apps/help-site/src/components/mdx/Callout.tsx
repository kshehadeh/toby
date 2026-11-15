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
	{ box: string; icon: LucideIcon; iconClass: string }
> = {
	note: {
		box: "border-line bg-white/[0.02]",
		icon: Info,
		iconClass: "text-muted",
	},
	info: {
		box: "border-sky-400/20 bg-sky-400/[0.05]",
		icon: Info,
		iconClass: "text-sky-300",
	},
	tip: {
		box: "border-emerald-400/20 bg-emerald-400/[0.05]",
		icon: Lightbulb,
		iconClass: "text-emerald-300",
	},
	warning: {
		box: "border-amber-400/25 bg-amber-400/[0.06]",
		icon: TriangleAlert,
		iconClass: "text-amber-300",
	},
	caution: {
		box: "border-amber-400/25 bg-amber-400/[0.06]",
		icon: TriangleAlert,
		iconClass: "text-amber-300",
	},
	danger: {
		box: "border-red-400/25 bg-red-400/[0.06]",
		icon: Flame,
		iconClass: "text-red-300",
	},
};

const defaultTitles: Record<CalloutType, string> = {
	note: "Note",
	info: "Info",
	tip: "Tip",
	warning: "Warning",
	caution: "Caution",
	danger: "Danger",
};

type CalloutProps = {
	readonly type?: CalloutType;
	/** Defaults to the type name, like Docusaurus admonitions. */
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
		<div
			className={`mb-6 flex gap-3 rounded-xl border px-4 py-3.5 ${style.box}`}
		>
			<Icon
				aria-hidden
				size={17}
				strokeWidth={2}
				className={`mt-[0.2rem] shrink-0 ${style.iconClass}`}
			/>
			<div className="min-w-0 flex-1">
				<div className="mb-1 text-sm font-semibold text-fg">
					{title ?? defaultTitles[type]}
				</div>
				<div className="text-[0.9375rem] [&_li]:text-[0.9375rem] [&_p]:mb-3 [&_p]:text-[0.9375rem] [&>*:last-child]:mb-0">
					{children}
				</div>
			</div>
		</div>
	);
}
