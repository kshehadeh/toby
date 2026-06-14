import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const markdownComponents: Components = {
	h1: ({ children }) => (
		<h1 className="mb-2 mt-3 text-base font-semibold first:mt-0">{children}</h1>
	),
	h2: ({ children }) => (
		<h2 className="mb-2 mt-3 text-sm font-semibold first:mt-0">{children}</h2>
	),
	h3: ({ children }) => (
		<h3 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h3>
	),
	p: ({ children }) => <p className="my-1.5 leading-relaxed">{children}</p>,
	ul: ({ children }) => (
		<ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>
	),
	ol: ({ children }) => (
		<ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>
	),
	li: ({ children }) => <li className="leading-relaxed">{children}</li>,
	blockquote: ({ children }) => (
		<blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">
			{children}
		</blockquote>
	),
	a: ({ href, children }) => (
		<a
			href={href}
			className="text-primary underline underline-offset-2 hover:opacity-80"
			target="_blank"
			rel="noreferrer"
		>
			{children}
		</a>
	),
	code: ({ className, children }) => {
		const isBlock = className?.includes("language-");
		if (isBlock) {
			return <code className={className}>{children}</code>;
		}
		return (
			<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
				{children}
			</code>
		);
	},
	pre: ({ children }) => (
		<pre className="my-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
			{children}
		</pre>
	),
	hr: () => <hr className="my-3 border-border" />,
	table: ({ children }) => (
		<div className="my-2 overflow-x-auto">
			<table className="w-full min-w-[24rem] border-collapse text-xs">
				{children}
			</table>
		</div>
	),
	thead: ({ children }) => (
		<thead className="border-b border-border bg-muted/60">{children}</thead>
	),
	tbody: ({ children }) => <tbody>{children}</tbody>,
	tr: ({ children }) => (
		<tr className="border-b border-border/70">{children}</tr>
	),
	th: ({ children }) => (
		<th className="px-3 py-1.5 text-left align-top font-semibold">
			{children}
		</th>
	),
	td: ({ children }) => (
		<td className="px-3 py-1.5 align-top leading-relaxed">{children}</td>
	),
};

export function AssistantMarkdown({ text }: { readonly text: string }) {
	return (
		<div className="ml-4 font-sans text-sm leading-relaxed text-foreground">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={markdownComponents}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
}
