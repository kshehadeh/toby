import path from "node:path";
import { evaluate } from "@mdx-js/mdx";
import rehypeShiki from "@shikijs/rehype";
import type { Element, Root as HastRoot } from "hast";
import { toString as hastToString } from "hast-util-to-string";
import type { Root as MdastRoot } from "mdast";
import type {} from "mdast-util-mdx-jsx";
import type { MDXComponents } from "mdx/types";
import type { ReactNode } from "react";
import * as runtime from "react/jsx-runtime";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import { VFile } from "vfile";
import { type Doc, docHref, getAllDocs } from "./docs";

export type TocEntry = {
	readonly depth: 2 | 3;
	readonly id: string;
	readonly text: string;
	/** Heading text split so inline `code` keeps its styling in the TOC. */
	readonly parts: readonly { readonly text: string; readonly code: boolean }[];
};

const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Resolve a link written in a doc to an absolute site URL.
 *
 * Supports the forms the docs already use: URL-relative (`./email`,
 * `../toby-app`), file-relative with extension (`../automations.md`), and
 * absolute (`/docs/intro`). Returns `undefined` for links left untouched
 * (external, hash-only, non-doc assets).
 */
function resolveDocHref(
	href: string,
	docId: string,
	known: ReadonlySet<string>,
	broken: string[],
): string | undefined {
	if (!href || EXTERNAL.test(href) || href.startsWith("#")) return undefined;
	const hashIndex = href.indexOf("#");
	const rawPath = hashIndex === -1 ? href : href.slice(0, hashIndex);
	const hash = hashIndex === -1 ? "" : href.slice(hashIndex);

	let target = rawPath.startsWith("/")
		? path.posix.normalize(rawPath)
		: path.posix.join(path.posix.dirname(docHref(docId)), rawPath);
	if (!target.startsWith("/docs/")) {
		// Static asset (e.g. /img/x.png, /slack-app-manifest.json) — leave as is.
		return rawPath.startsWith("/") ? undefined : target + hash;
	}
	target = target.replace(/\.mdx?$/, "").replace(/\/$/, "");
	if (!known.has(target.slice("/docs/".length))) broken.push(href);
	return target + hash;
}

function remarkDocLinks(options: { docId: string }) {
	const known = new Set(getAllDocs().keys());
	return (tree: MdastRoot) => {
		const broken: string[] = [];
		visit(tree, (node) => {
			if (node.type === "link" || node.type === "definition") {
				const next = resolveDocHref(node.url, options.docId, known, broken);
				if (next !== undefined) node.url = next;
			} else if (
				node.type === "mdxJsxFlowElement" ||
				node.type === "mdxJsxTextElement"
			) {
				for (const attr of node.attributes) {
					if (
						attr.type === "mdxJsxAttribute" &&
						attr.name === "href" &&
						typeof attr.value === "string"
					) {
						const next = resolveDocHref(
							attr.value,
							options.docId,
							known,
							broken,
						);
						if (next !== undefined) attr.value = next;
					}
				}
			}
		});
		if (broken.length > 0) {
			throw new Error(
				`Broken doc link(s) in docs/${options.docId}.mdx: ${broken.join(", ")}`,
			);
		}
	};
}

/** ```mermaid fences → <Mermaid chart="…" /> (rendered client-side). */
function remarkMermaid() {
	return (tree: MdastRoot) => {
		visit(tree, "code", (node, index, parent) => {
			if (node.lang !== "mermaid" || !parent || index === undefined) return;
			parent.children[index] = {
				type: "mdxJsxFlowElement",
				name: "Mermaid",
				attributes: [
					{ type: "mdxJsxAttribute", name: "chart", value: node.value },
				],
				children: [],
			};
		});
	};
}

/** Collect h2/h3 (with ids from rehype-slug) for the "On this page" rail. */
function rehypeToc() {
	return (tree: HastRoot, file: VFile) => {
		const toc: TocEntry[] = [];
		visit(tree, "element", (node: Element) => {
			if (
				(node.tagName === "h2" || node.tagName === "h3") &&
				node.properties.id
			) {
				toc.push({
					depth: node.tagName === "h2" ? 2 : 3,
					id: String(node.properties.id),
					text: hastToString(node),
					parts: node.children.map((child) => ({
						text: hastToString(child),
						code: child.type === "element" && child.tagName === "code",
					})),
				});
			}
		});
		file.data.toc = toc;
	};
}

/** Tag inline `code` so the MDX `code` component can style it apart from blocks. */
function rehypeInlineCode() {
	return (tree: HastRoot) => {
		visit(tree, "element", (node: Element, _index, parent) => {
			if (node.tagName !== "code") return;
			if (parent && "tagName" in parent && parent.tagName === "pre") return;
			node.properties.dataInline = true;
		});
	};
}

export type CompiledDoc = {
	readonly content: (props: { components?: MDXComponents }) => ReactNode;
	readonly toc: readonly TocEntry[];
};

export async function compileDoc(doc: Doc): Promise<CompiledDoc> {
	const file = new VFile({ value: doc.body, path: doc.filePath });
	const { default: content } = await evaluate(file, {
		...runtime,
		development: false,
		remarkPlugins: [
			remarkGfm,
			remarkMermaid,
			[remarkDocLinks, { docId: doc.id }],
		],
		rehypePlugins: [
			rehypeSlug,
			rehypeToc,
			[
				rehypeShiki,
				{
					theme: "one-dark-pro",
					defaultLanguage: "text",
					fallbackLanguage: "text",
				},
			],
			rehypeInlineCode,
		],
	});
	return {
		content: content as CompiledDoc["content"],
		toc: (file.data.toc as TocEntry[] | undefined) ?? [],
	};
}
