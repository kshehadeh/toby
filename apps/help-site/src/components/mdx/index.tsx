import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";
import { DownloadTobyButton } from "../DownloadTobyButton";
import { Callout } from "./Callout";
import { CopyButton } from "./CopyButton";
import { FeatureHeading } from "./FeatureHeading";
import { Mermaid } from "./Mermaid";
import {
	ArchitectureDiagram,
	BrandTitle,
	InlineIcon,
	IntegrationCard,
	IntegrationGrid,
} from "./brand";

const linkClass =
	"text-fg underline decoration-line-strong underline-offset-[3px] transition-colors hover:text-accent hover:decoration-accent";

function HashLink({
	id,
	label,
}: { readonly id?: string; readonly label: string }) {
	if (!id) return null;
	return (
		<a
			href={`#${id}`}
			aria-label={`Direct link to ${label}`}
			className="pl-2 font-normal text-accent no-underline opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
		>
			#
		</a>
	);
}

function textOf(children: unknown): string {
	if (typeof children === "string" || typeof children === "number")
		return String(children);
	if (Array.isArray(children)) return children.map(textOf).join("");
	if (children && typeof children === "object" && "props" in children) {
		return textOf(
			(children as { props: { children?: unknown } }).props.children,
		);
	}
	return "";
}

function DocLink({
	href = "",
	children,
	...rest
}: ComponentPropsWithoutRef<"a">) {
	if (href.startsWith("/") && !href.startsWith("//")) {
		return (
			<Link href={href} className={linkClass} {...rest}>
				{children}
			</Link>
		);
	}
	const external = /^https?:\/\//.test(href);
	return (
		<a
			href={href}
			className={linkClass}
			{...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
			{...rest}
		>
			{children}
		</a>
	);
}

/** Element → Tailwind mapping for everything rendered from MDX docs. */
export const mdxComponents: MDXComponents = {
	h1: (props) => (
		<h1
			className="mb-4 text-[2.25rem] font-semibold leading-[1.15] tracking-[-0.035em] text-fg"
			{...props}
		/>
	),
	h2: ({ id, children, ...props }) => (
		<h2
			id={id}
			className="group mt-12 mb-4 scroll-mt-20 text-[1.5rem] font-semibold leading-tight tracking-[-0.025em] text-fg"
			{...props}
		>
			{children}
			<HashLink id={id} label={textOf(children)} />
		</h2>
	),
	h3: ({ id, children, ...props }) => (
		<h3
			id={id}
			className="group mt-8 mb-3 scroll-mt-20 text-[1.125rem] font-semibold leading-snug tracking-[-0.015em] text-fg"
			{...props}
		>
			{children}
			<HashLink id={id} label={textOf(children)} />
		</h3>
	),
	h4: ({ id, children, ...props }) => (
		<h4
			id={id}
			className="group mt-6 mb-3 scroll-mt-20 text-base font-semibold text-fg"
			{...props}
		>
			{children}
			<HashLink id={id} label={textOf(children)} />
		</h4>
	),
	p: (props) => (
		<p className="mb-5 text-[0.9375rem] leading-[1.75] text-muted" {...props} />
	),
	a: DocLink,
	strong: (props) => <strong className="font-semibold text-fg" {...props} />,
	ul: (props) => (
		<ul
			className="mb-5 list-disc pl-6 [&_ol]:mb-0 [&_ul]:mb-0 [&_ul]:list-[circle]"
			{...props}
		/>
	),
	ol: (props) => (
		<ol className="mb-5 list-decimal pl-6 [&_ol]:mb-0 [&_ul]:mb-0" {...props} />
	),
	li: (props) => (
		<li
			className="mt-1.5 text-[0.9375rem] leading-[1.75] text-muted marker:text-faint [&>p]:mb-2 [&>p:last-child]:mb-0"
			{...props}
		/>
	),
	blockquote: (props) => (
		<blockquote
			className="mb-5 border-l-2 border-line-strong pl-4 text-muted [&>p:last-child]:mb-0"
			{...props}
		/>
	),
	hr: (props) => <hr className="my-10 border-line-subtle" {...props} />,
	img: ({ alt, ...props }) => (
		<img
			{...props}
			alt={alt ?? ""}
			loading="lazy"
			className="my-2 h-auto max-w-full rounded-lg border border-line"
		/>
	),
	table: (props) => (
		<div className="mb-6 max-w-full overflow-x-auto rounded-xl border border-line">
			<table
				className="w-full border-separate border-spacing-0 text-left text-sm"
				{...props}
			/>
		</div>
	),
	thead: (props) => <thead className="bg-white/[0.02]" {...props} />,
	th: (props) => (
		<th
			className="border-b border-line px-4 py-2.5 text-[0.8125rem] font-medium text-fg"
			{...props}
		/>
	),
	td: (props) => (
		<td
			className="border-t border-line-subtle px-4 py-2.5 align-top text-muted [tr:first-child>&]:border-t-0"
			{...props}
		/>
	),
	code: ({
		"data-inline": inline,
		...props
	}: ComponentPropsWithoutRef<"code"> & { "data-inline"?: unknown }) =>
		inline ? (
			<code
				className="rounded-[5px] border border-line bg-white/[0.04] px-[0.35em] py-[0.1em] font-mono text-[0.85em] text-fg break-words"
				{...props}
			/>
		) : (
			<code {...props} />
		),
	pre: (props) => (
		<div data-code-block className="group relative mb-6">
			<pre
				{...props}
				className="overflow-x-auto rounded-xl border border-line bg-surface! p-4 font-mono text-[0.8125rem] leading-[1.65] [&_code]:font-mono"
			/>
			<CopyButton />
		</div>
	),

	// Custom components available in every doc without an import.
	ArchitectureDiagram,
	BrandTitle,
	Callout,
	DownloadTobyButton,
	FeatureHeading,
	InlineIcon,
	IntegrationCard,
	IntegrationGrid,
	Mermaid,
};
