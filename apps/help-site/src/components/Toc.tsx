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
					3.5 +
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
		<ul className="text-[0.8125rem] leading-[1.5]">
			{toc.map((entry) => (
				<li
					key={entry.id}
					className={`py-1 ${entry.depth === 3 ? "pl-3" : ""}`}
				>
					<a
						href={`#${entry.id}`}
						className={`-ml-px block border-l py-0.5 pl-3 transition-colors hover:text-fg ${
							entry.id === active
								? "border-accent text-fg"
								: "border-transparent text-faint"
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
		<div className="sticky top-[calc(var(--spacing-navbar)+1rem)] max-h-[calc(100vh-var(--spacing-navbar)-2rem)] overflow-y-auto py-2">
			<div className="mb-3 text-xs font-medium text-fg">On this page</div>
			<div className="border-l border-line-subtle">
				<TocList toc={toc} active={active} />
			</div>
		</div>
	);
}

/** Collapsible "On this page" box shown above content on narrow screens. */
export function TocMobile({ toc }: { readonly toc: readonly TocEntry[] }) {
	if (toc.length === 0) return null;
	return (
		<details className="group mb-6 rounded-lg border border-line bg-surface lg:hidden">
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
