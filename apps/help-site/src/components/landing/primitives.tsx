import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

/** Delay for staggered `data-reveal` children. */
export function delay(ms: number): CSSProperties {
	return { "--reveal-delay": `${ms}ms` } as CSSProperties;
}

export function Container({
	className = "",
	children,
}: { readonly className?: string; readonly children: ReactNode }) {
	return (
		<div className={`mx-auto w-full max-w-[1200px] px-4 sm:px-6 ${className}`}>
			{children}
		</div>
	);
}

export function Eyebrow({ children }: { readonly children: ReactNode }) {
	return (
		<div className="mb-4 inline-flex items-center gap-2 text-[0.8125rem] font-medium text-accent">
			<span aria-hidden className="size-1.5 rounded-full bg-accent" />
			{children}
		</div>
	);
}

export function SectionHeading({
	eyebrow,
	title,
	lead,
	align = "left",
}: {
	readonly eyebrow: string;
	readonly title: ReactNode;
	readonly lead?: ReactNode;
	readonly align?: "left" | "center";
}) {
	const centered = align === "center";
	return (
		<div
			data-reveal
			className={`mb-12 max-w-3xl ${centered ? "mx-auto text-center" : ""}`}
		>
			<Eyebrow>{eyebrow}</Eyebrow>
			<h2 className="text-gradient text-display-md font-semibold">{title}</h2>
			{lead ? (
				<p className="mt-4 text-[1.0625rem] leading-relaxed text-muted">
					{lead}
				</p>
			) : null}
		</div>
	);
}

export function TextLink({
	href,
	children,
}: { readonly href: string; readonly children: ReactNode }) {
	const external = href.startsWith("http");
	const Icon = external ? ArrowUpRight : ArrowRight;
	const className =
		"group/link inline-flex items-center gap-1 text-sm font-medium text-fg transition-colors hover:text-accent";
	const inner = (
		<>
			{children}
			<Icon
				aria-hidden
				size={14}
				className="transition-transform group-hover/link:translate-x-0.5"
			/>
		</>
	);
	return external ? (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className={className}
		>
			{inner}
		</a>
	) : (
		<Link href={href} className={className}>
			{inner}
		</Link>
	);
}

/** Dark window frame around an app screenshot. */
export function Screenshot({
	src,
	alt,
	className = "",
	priority = false,
}: {
	readonly src: string;
	readonly alt: string;
	readonly className?: string;
	readonly priority?: boolean;
}) {
	return (
		<div
			className={`rounded-xl border border-line-strong bg-white/[0.03] p-1.5 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.8)] ${className}`}
		>
			<img
				src={src}
				alt={alt}
				loading={priority ? "eager" : "lazy"}
				decoding="async"
				className="block h-auto w-full rounded-lg border border-line-subtle"
			/>
		</div>
	);
}
