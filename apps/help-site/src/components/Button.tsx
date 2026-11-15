import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

type Variant = "primary" | "accent" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

const base =
	"inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap no-underline transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50";

const variants: Record<Variant, string> = {
	primary: "bg-fg text-canvas hover:bg-white",
	accent:
		"bg-accent text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2)] hover:bg-accent-dim",
	secondary:
		"border border-line-strong bg-white/[0.03] text-fg hover:border-white/25 hover:bg-white/[0.06]",
	ghost: "text-muted hover:bg-white/5 hover:text-fg",
};

const sizes: Record<Size, string> = {
	sm: "h-8 px-3 text-[0.8125rem]",
	md: "h-10 px-4 text-sm",
	lg: "h-12 px-5 text-[0.9375rem]",
};

export function buttonClass(
	variant: Variant = "primary",
	size: Size = "md",
	className = "",
): string {
	return `${base} ${variants[variant]} ${sizes[size]} ${className}`;
}

type ButtonLinkProps = Omit<ComponentPropsWithoutRef<"a">, "href"> & {
	readonly href: string;
	readonly variant?: Variant;
	readonly size?: Size;
	readonly children: ReactNode;
};

/** Link styled as a button; internal hrefs use Next's client navigation. */
export function ButtonLink({
	href,
	variant,
	size,
	className,
	children,
	...rest
}: ButtonLinkProps) {
	const classes = buttonClass(variant, size, className);
	if (href.startsWith("/") && !href.startsWith("//")) {
		return (
			<Link href={href} className={classes} {...rest}>
				{children}
			</Link>
		);
	}
	const external = /^https?:\/\//.test(href);
	return (
		<a
			href={href}
			className={classes}
			{...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
			{...rest}
		>
			{children}
		</a>
	);
}
