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
	"text-fg underline decoration-line underline-offset-[3px] transition-colors hover:text-accent hover:decoration-accent";

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
			className="mb-3 text-4xl font-bold leading-tight tracking-[-0.025em] text-fg"
			{...props}
		/>
	),
	h2: ({ id, children, ...props }) => (
		<h2
			id={id}
			className="group mt-10 mb-5 scroll-mt-20 border-b border-line-subtle pb-2 text-[1.375rem] font-semibold leading-tight tracking-[-0.02em] text-fg"
			{...props}
		>
			{children}
			<HashLink id={id} label={textOf(children)} />
		</h2>
	),
	h3: ({ id, children, ...props }) => (
		<h3
			id={id}
			className="group mt-8 mb-4 scroll-mt-20 text-[1.1rem] font-semibold leading-snug text-fg"
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
	p: (props) => <p className="mb-5 leading-[1.7] text-muted" {...props} />,
	a: DocLink,
	strong: (props) => <strong className="font-bold text-fg" {...props} />,
	ul: (props) => (
		<ul
			className="mb-5 list-disc pl-8 [&_ol]:mb-0 [&_ul]:mb-0 [&_ul]:list-[circle]"
			{...props}
		/>
	),
	ol: (props) => (
		<ol className="mb-5 list-decimal pl-8 [&_ol]:mb-0 [&_ul]:mb-0" {...props} />
	),
	li: (props) => (
		<li
			className="mt-1 leading-[1.7] text-muted [&>p]:mb-2 [&>p:last-child]:mb-0"
			{...props}
		/>
	),
	blockquote: (props) => (
		<blockquote
			className="mb-5 border-l-4 border-line pl-4 text-muted [&>p:last-child]:mb-0"
			{...props}
		/>
	),
	hr: (props) => <hr className="my-6 border-line" {...props} />,
	img: ({ alt, ...props }) => (
		<img
			{...props}
			alt={alt ?? ""}
			loading="lazy"
			className="h-auto max-w-full"
		/>
	),
	table: (props) => (
		<div className="mb-5 max-w-full overflow-x-auto rounded-lg border border-line">
			<table
				className="border-separate border-spacing-0 text-left"
				{...props}
			/>
		</div>
	),
	thead: (props) => <thead className="bg-surface-raised" {...props} />,
	th: (props) => (
		<th
			className="border-b border-l border-line p-3 text-center text-[0.8125rem] font-semibold text-fg first:border-l-0"
			{...props}
		/>
	),
	td: (props) => (
		<td
			className="border-l border-t border-line-subtle p-3 text-muted first:border-l-0 [tr:first-child>&]:border-t-0"
			{...props}
		/>
	),
	code: ({
		"data-inline": inline,
		...props
	}: ComponentPropsWithoutRef<"code"> & { "data-inline"?: unknown }) =>
		inline ? (
			<code
				className="rounded-md border border-line-subtle bg-surface-raised px-[0.4em] py-[0.15em] font-mono text-[0.875em] break-words"
				{...props}
			/>
		) : (
			<code {...props} />
		),
	pre: (props) => (
		<div data-code-block className="group relative mb-5">
			<pre
				{...props}
				className="overflow-x-auto rounded-lg border border-line p-4 font-mono text-[0.95rem] leading-[1.45] [&_code]:font-mono"
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
