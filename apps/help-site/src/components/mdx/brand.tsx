import Link from "next/link";
import type { ReactNode } from "react";

const iconBox =
	"box-content size-10 shrink-0 rounded-lg border border-line bg-surface-raised p-1.5";

type BrandTitleProps = {
	/** Logo image path (e.g. `/img/integrations/slack.png`). */
	readonly icon?: string;
	/** Emoji shown instead of an image. */
	readonly emoji?: string;
	readonly children: ReactNode;
};

/** Page H1 with a brand logo (integrations, AI providers). */
export function BrandTitle({ icon, emoji, children }: BrandTitleProps) {
	return (
		<h1 className="mb-3 flex items-center gap-3 text-4xl font-bold leading-tight tracking-[-0.025em] text-fg">
			{icon ? (
				<img
					src={icon}
					alt=""
					width={40}
					height={40}
					className={`${iconBox} object-contain`}
				/>
			) : (
				<span
					aria-hidden="true"
					className={`${iconBox} flex items-center justify-center text-2xl leading-none`}
				>
					{emoji}
				</span>
			)}
			{children}
		</h1>
	);
}

/** Small logo inline with text, e.g. in a table cell. */
export function InlineIcon({ src }: { readonly src: string }) {
	return (
		<img
			src={src}
			alt=""
			width={20}
			height={20}
			className="mr-[0.4rem] inline-block size-5 rounded object-contain align-[-4px]"
		/>
	);
}

export function IntegrationGrid({
	children,
}: { readonly children: ReactNode }) {
	return (
		<div className="mt-2.5 mb-7 grid grid-cols-[repeat(auto-fit,minmax(10.5rem,1fr))] gap-[0.85rem]">
			{children}
		</div>
	);
}

type IntegrationCardProps = {
	readonly href: string;
	readonly name: string;
	readonly meta: string;
	readonly icon?: string;
	readonly emoji?: string;
};

export function IntegrationCard({
	href,
	name,
	meta,
	icon,
	emoji,
}: IntegrationCardProps) {
	return (
		<Link
			href={href}
			className="flex min-h-[8.75rem] flex-col gap-[0.55rem] rounded-lg border border-line bg-linear-180 from-surface-raised to-surface p-4 no-underline transition duration-100 hover:-translate-y-px hover:border-faint hover:bg-surface-hover hover:bg-none"
		>
			<span className="inline-flex size-11 items-center justify-center rounded-full border border-line-subtle bg-white/4">
				{icon ? (
					<img src={icon} alt="" className="size-[1.55rem] object-contain" />
				) : (
					<span className="text-[0.92rem] font-extrabold tracking-[-0.03em] text-fg">
						{emoji}
					</span>
				)}
			</span>
			<span className="text-[0.98rem] font-[650] text-fg">{name}</span>
			<span className="text-[0.78rem] leading-[1.45] text-faint">{meta}</span>
		</Link>
	);
}

/** Wide diagram image in a bordered, horizontally scrollable frame. */
export function ArchitectureDiagram({
	src,
	alt,
}: { readonly src: string; readonly alt: string }) {
	return (
		<div className="mt-6 mb-8 w-full max-w-[66.25rem] overflow-x-auto rounded-lg border border-line bg-surface-raised p-3">
			<img
				src={src}
				alt={alt}
				className="block h-auto w-full min-w-[42rem] rounded-md"
			/>
		</div>
	);
}
