import type { DocNav } from "@/lib/docs";
import { ArrowLeft, ArrowRight, SquarePen } from "lucide-react";
import Link from "next/link";

export function Breadcrumbs({
	crumbs,
}: { readonly crumbs: DocNav["breadcrumbs"] }) {
	return (
		<nav aria-label="Breadcrumbs" className="mb-6">
			<ol className="flex flex-wrap items-center gap-y-1 text-[0.8125rem] text-faint">
				<li className="flex items-center">
					<Link
						href="/docs"
						prefetch={false}
						className="transition-colors hover:text-fg"
					>
						Docs
					</Link>
				</li>
				{crumbs.map((crumb, i) => {
					const last = i === crumbs.length - 1;
					return (
						<li key={`${crumb.label}-${i}`} className="flex items-center">
							<span aria-hidden className="mx-2 opacity-50">
								/
							</span>
							{last ? (
								<span aria-current="page" className="text-muted">
									{crumb.label}
								</span>
							) : crumb.href ? (
								<Link
									href={crumb.href}
									className="transition-colors hover:text-fg"
								>
									{crumb.label}
								</Link>
							) : (
								<span>{crumb.label}</span>
							)}
						</li>
					);
				})}
			</ol>
		</nav>
	);
}

export function EditThisPage({ href }: { readonly href: string }) {
	return (
		<div className="mt-14">
			<a
				href={href}
				target="_blank"
				rel="noopener noreferrer"
				className="inline-flex items-center gap-1.5 text-[0.8125rem] text-faint transition-colors hover:text-fg"
			>
				<SquarePen aria-hidden size={14} />
				Edit this page on GitHub
			</a>
		</div>
	);
}

export function Pagination({
	previous,
	next,
}: Pick<DocNav, "previous" | "next">) {
	if (!previous && !next) return null;
	const card =
		"group block rounded-xl border border-line p-4 transition-colors duration-150 hover:border-line-strong hover:bg-white/[0.02]";
	const label =
		"mb-1 flex items-center gap-1.5 text-xs text-faint transition-colors group-hover:text-muted";
	return (
		<nav
			aria-label="Docs pages"
			className="mt-6 grid grid-cols-2 gap-3 border-t border-line-subtle pt-6"
		>
			{previous ? (
				<Link href={previous.href} className={card}>
					<div className={label}>
						<ArrowLeft aria-hidden size={13} />
						Previous
					</div>
					<div className="text-sm font-medium text-fg">{previous.label}</div>
				</Link>
			) : (
				<span />
			)}
			{next ? (
				<Link href={next.href} className={`${card} col-start-2 text-right`}>
					<div className={`${label} justify-end`}>
						Next
						<ArrowRight aria-hidden size={13} />
					</div>
					<div className="text-sm font-medium text-fg">{next.label}</div>
				</Link>
			) : null}
		</nav>
	);
}
