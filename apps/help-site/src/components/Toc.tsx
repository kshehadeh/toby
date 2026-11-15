"use client";

import type { TocEntry } from "@/lib/mdx";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";

/** Heading id currently at the top of the viewport (below the sticky navbar). */
function useActiveHeading(key: string): string | undefined {
	const [active, setActive] = useState<string | undefined>(undefined);

	useEffect(() => {
		const ids = key ? key.split("\n") : [];
		if (ids.length === 0) return;
		let frame = 0;
		const update = () => {
			frame = 0;
			const offset =
				Number.parseFloat(getComputedStyle(document.documentElement).fontSize) *
					3.75 +
				24;
			let current: string | undefined;
			for (const id of ids) {
				const el = document.getElementById(id);
				if (!el) continue;
				if (el.getBoundingClientRect().top - offset <= 0) current = id;
				else break;
			}
			const atBottom =
				window.innerHeight + window.scrollY >=
				document.documentElement.scrollHeight - 2;
			setActive(atBottom ? ids[ids.length - 1] : (current ?? ids[0]));
		};
		const onScroll = () => {
			if (!frame) frame = requestAnimationFrame(update);
		};
		update();
		window.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("resize", onScroll);
		return () => {
			window.removeEventListener("scroll", onScroll);
			window.removeEventListener("resize", onScroll);
			if (frame) cancelAnimationFrame(frame);
		};
	}, [key]);

	return active;
}

function TocList({
	toc,
	active,
}: { readonly toc: readonly TocEntry[]; readonly active?: string }) {
	return (
		<ul className="text-[0.8125rem] leading-[1.65]">
			{toc.map((entry) => (
				<li
					key={entry.id}
					className={`mx-2 my-2 ${entry.depth === 3 ? "pl-4" : ""}`}
				>
					<a
						href={`#${entry.id}`}
						className={`transition-colors hover:text-fg ${
							entry.id === active ? "font-medium text-fg" : "text-faint"
						}`}
					>
						{entry.parts.map((part, i) =>
							part.code ? (
								<code
									// biome-ignore lint/suspicious/noArrayIndexKey: static, order-stable heading parts
									key={i}
									className="rounded-md border border-line-subtle bg-surface-raised px-[0.4em] py-[0.1em] font-mono text-[0.75rem]"
								>
									{part.text}
								</code>
							) : (
								part.text
							),
						)}
					</a>
				</li>
			))}
		</ul>
	);
}

/** Right-rail "on this page" list with scroll-spy (desktop). */
export function Toc({ toc }: { readonly toc: readonly TocEntry[] }) {
	const active = useActiveHeading(toc.map((t) => t.id).join("\n"));
	if (toc.length === 0) return null;
	return (
		<div className="sticky top-[calc(var(--spacing-navbar)+1rem)] max-h-[calc(100vh-var(--spacing-navbar)-2rem)] overflow-y-auto border-l border-line-subtle py-2 pl-2">
			<TocList toc={toc} active={active} />
		</div>
	);
}

/** Collapsible "On this page" box shown above content on narrow screens. */
export function TocMobile({ toc }: { readonly toc: readonly TocEntry[] }) {
	if (toc.length === 0) return null;
	return (
		<details className="group mb-4 rounded-lg bg-surface-hover lg:hidden">
			<summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-medium text-fg [&::-webkit-details-marker]:hidden">
				On this page
				<ChevronDown
					aria-hidden
					size={16}
					className="transition-transform group-open:rotate-180"
				/>
			</summary>
			<div className="border-t border-line px-3 pb-1">
				<TocList toc={toc} />
			</div>
		</details>
	);
}
