import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { type SidebarItem, sidebar } from "./sidebar";

/** Source directory for help-site pages (`docs/<id>.mdx`). */
export const DOCS_DIR = path.join(process.cwd(), "docs");

export const SITE = {
	title: "Toby",
	tagline: "Native macOS AI assistant for personal productivity workflows.",
	url: "https://toby.iwonderdesigns.com",
	github: "https://github.com/kshehadeh/toby",
	editBase: "https://github.com/kshehadeh/toby/tree/main/apps/help-site/docs/",
} as const;

export type DocMeta = {
	/** Path under `docs/` without extension, e.g. `integrations/email`. */
	readonly id: string;
	readonly title: string;
	readonly description?: string;
	readonly sidebarLabel: string;
	readonly filePath: string;
};

export type Doc = DocMeta & { readonly body: string };

let cache: Map<string, Doc> | undefined;

function walk(dir: string): string[] {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return walk(full);
		return entry.name.endsWith(".mdx") ? [full] : [];
	});
}

function firstHeading(body: string): string | undefined {
	return body.match(/^#\s+(.+)$/m)?.[1]?.trim();
}

/** All docs keyed by id. Read once per build. */
export function getAllDocs(): Map<string, Doc> {
	if (cache) return cache;
	const docs = new Map<string, Doc>();
	for (const filePath of walk(DOCS_DIR)) {
		const id = path
			.relative(DOCS_DIR, filePath)
			.replace(/\\/g, "/")
			.replace(/\.mdx$/, "");
		const { data, content } = matter(fs.readFileSync(filePath, "utf8"));
		const title =
			(typeof data.title === "string" && data.title) ||
			firstHeading(content) ||
			id;
		docs.set(id, {
			id,
			title,
			description:
				typeof data.description === "string" ? data.description : undefined,
			sidebarLabel:
				typeof data.sidebar_label === "string" ? data.sidebar_label : title,
			filePath,
			body: content,
		});
	}
	cache = docs;
	return docs;
}

export function getDoc(id: string): Doc | undefined {
	return getAllDocs().get(id);
}

export function docHref(id: string): string {
	return `/docs/${id}`;
}

// ── Sidebar-derived navigation ─────────────────────────────────────────

/** Serializable sidebar tree handed to client components. */
export type NavNode =
	| {
			readonly kind: "doc";
			readonly id: string;
			readonly label: string;
			readonly href: string;
	  }
	| {
			readonly kind: "category";
			readonly label: string;
			readonly href?: string;
			readonly linkId?: string;
			readonly icon?: string;
			/** Every doc id inside (including the linked doc), for "is active" checks. */
			readonly docIds: readonly string[];
			readonly children: readonly NavNode[];
	  };

function requireDoc(id: string): Doc {
	const doc = getDoc(id);
	if (!doc) throw new Error(`Sidebar references missing doc "${id}"`);
	return doc;
}

function toNav(item: SidebarItem): NavNode {
	if (typeof item === "string") {
		const doc = requireDoc(item);
		return {
			kind: "doc",
			id: doc.id,
			label: doc.sidebarLabel,
			href: docHref(doc.id),
		};
	}
	const children = item.items.map(toNav);
	if (item.link) requireDoc(item.link);
	const docIds = [
		...(item.link ? [item.link] : []),
		...children.flatMap((c) => (c.kind === "doc" ? [c.id] : c.docIds)),
	];
	return {
		kind: "category",
		label: item.label,
		href: item.link ? docHref(item.link) : undefined,
		linkId: item.link,
		icon: item.icon,
		docIds,
		children,
	};
}

export function getNavTree(): NavNode[] {
	return sidebar.map(toNav);
}

type Crumb = { readonly label: string; readonly href?: string };

type FlatEntry = {
	readonly id: string;
	readonly label: string;
	readonly crumbs: readonly Crumb[];
};

/** Sidebar in reading order, the way prev/next pagination walks it. */
function flatten(
	nodes: readonly NavNode[],
	crumbs: readonly Crumb[] = [],
): FlatEntry[] {
	return nodes.flatMap((node): FlatEntry[] => {
		if (node.kind === "doc")
			return [{ id: node.id, label: node.label, crumbs }];
		const here = [...crumbs, { label: node.label, href: node.href }];
		const self = node.linkId
			? [{ id: node.linkId, label: node.label, crumbs }]
			: [];
		return [...self, ...flatten(node.children, here)];
	});
}

export type DocNav = {
	readonly breadcrumbs: readonly Crumb[];
	readonly previous?: { readonly label: string; readonly href: string };
	readonly next?: { readonly label: string; readonly href: string };
};

export function getDocNav(id: string): DocNav {
	const flat = flatten(getNavTree());
	const index = flat.findIndex((entry) => entry.id === id);
	const doc = requireDoc(id);
	if (index === -1) return { breadcrumbs: [{ label: doc.title }] };
	const entry = flat[index];
	const prev = flat[index - 1];
	const next = flat[index + 1];
	return {
		breadcrumbs: [...entry.crumbs, { label: entry.label }],
		previous: prev && { label: prev.label, href: docHref(prev.id) },
		next: next && { label: next.label, href: docHref(next.id) },
	};
}
