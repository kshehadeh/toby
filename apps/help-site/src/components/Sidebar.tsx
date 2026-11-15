"use client";

import type { NavNode } from "@/lib/docs";
import {
	AppWindow,
	Blocks,
	ChevronRight,
	Code,
	type LucideIcon,
	MessageCircle,
	Rocket,
	Settings2,
	Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const categoryIcons: Record<string, LucideIcon> = {
	rocket: Rocket,
	app: AppWindow,
	blocks: Blocks,
	sparkles: Sparkles,
	settings: Settings2,
	code: Code,
	message: MessageCircle,
};

function activeDocId(pathname: string): string {
	return pathname
		.replace(/^\/docs\//, "")
		.replace(/\.html$/, "")
		.replace(/\/$/, "");
}

function DocItem({
	node,
	active,
	onNavigate,
}: {
	readonly node: Extract<NavNode, { kind: "doc" }>;
	readonly active: boolean;
	readonly onNavigate?: () => void;
}) {
	return (
		<li className="mt-px first:mt-0">
			<Link
				href={node.href}
				onClick={onNavigate}
				aria-current={active ? "page" : undefined}
				className={`block rounded-md px-[0.65rem] py-[0.3rem] text-[0.8125rem] leading-[1.45] transition-colors duration-100 ${
					active
						? "bg-white/[0.06] font-medium text-fg"
						: "text-muted hover:bg-white/[0.03] hover:text-fg"
				}`}
			>
				{node.label}
			</Link>
		</li>
	);
}

function CategoryItem({
	node,
	current,
	level,
	onNavigate,
}: {
	readonly node: Extract<NavNode, { kind: "category" }>;
	readonly current: string;
	readonly level: number;
	readonly onNavigate?: () => void;
}) {
	const containsActive = node.docIds.includes(current);
	const [open, setOpen] = useState(containsActive);

	// Expand when navigation lands inside this category (never auto-collapse).
	useEffect(() => {
		if (containsActive) setOpen(true);
	}, [containsActive]);

	const Icon = node.icon ? categoryIcons[node.icon] : undefined;
	const labelClass =
		"flex flex-1 items-center gap-[0.45rem] px-[0.65rem] pt-4 pb-[0.35rem] text-left text-xs font-medium leading-[1.4] text-faint transition-colors hover:text-fg";
	const label = (
		<>
			{Icon ? (
				<Icon
					aria-hidden
					className="size-3.5 shrink-0 opacity-90"
					strokeWidth={2}
				/>
			) : null}
			{node.label}
		</>
	);
	const caret = (
		<ChevronRight
			aria-hidden
			className={`size-4 shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
		/>
	);

	return (
		<li className={level === 1 ? "mt-1 first:mt-0" : "mt-1"}>
			<div
				className={`flex items-end rounded-md ${containsActive ? "[&>a]:text-fg [&>button]:text-fg" : ""}`}
			>
				{node.href ? (
					<>
						<Link
							href={node.href}
							onClick={() => {
								setOpen(true);
								onNavigate?.();
							}}
							aria-current={current === node.linkId ? "page" : undefined}
							className={labelClass}
						>
							{label}
						</Link>
						<button
							type="button"
							onClick={() => setOpen((v) => !v)}
							aria-expanded={open}
							aria-label={`${open ? "Collapse" : "Expand"} sidebar category '${node.label}'`}
							className="mb-0.5 rounded-md px-[0.65rem] py-[0.3rem] text-faint transition-colors hover:bg-white/[0.04] hover:text-fg"
						>
							{caret}
						</button>
					</>
				) : (
					<button
						type="button"
						onClick={() => setOpen((v) => !v)}
						aria-expanded={open}
						className={`${labelClass} justify-between`}
					>
						<span className="flex items-center gap-[0.45rem]">{label}</span>
						{caret}
					</button>
				)}
			</div>
			{open ? (
				<ul className="mt-0.5 ml-[0.9rem] border-l border-line-subtle pl-1.5">
					<NavList
						nodes={node.children}
						current={current}
						level={level + 1}
						onNavigate={onNavigate}
					/>
				</ul>
			) : null}
		</li>
	);
}

function NavList({
	nodes,
	current,
	level,
	onNavigate,
}: {
	readonly nodes: readonly NavNode[];
	readonly current: string;
	readonly level: number;
	readonly onNavigate?: () => void;
}) {
	return nodes.map((node) =>
		node.kind === "doc" ? (
			<DocItem
				key={node.id}
				node={node}
				active={node.id === current}
				onNavigate={onNavigate}
			/>
		) : (
			<CategoryItem
				key={node.label}
				node={node}
				current={current}
				level={level}
				onNavigate={onNavigate}
			/>
		),
	);
}

/** Docs navigation tree (desktop rail and mobile drawer). */
export function Sidebar({
	nodes,
	onNavigate,
}: {
	readonly nodes: readonly NavNode[];
	readonly onNavigate?: () => void;
}) {
	const current = activeDocId(usePathname() ?? "");
	return (
		<nav aria-label="Docs sidebar" className="px-3 pt-4 pb-8">
			<ul>
				<NavList
					nodes={nodes}
					current={current}
					level={1}
					onNavigate={onNavigate}
				/>
			</ul>
		</nav>
	);
}
