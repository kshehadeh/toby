import type { DocNav } from "@/lib/docs";
import { ChevronRight, House, SquarePen } from "lucide-react";
import Link from "next/link";

export function Breadcrumbs({
	crumbs,
}: { readonly crumbs: DocNav["breadcrumbs"] }) {
	const pill = "rounded-full px-3 py-1.5 text-[0.8125rem] transition-colors";
	return (
		<nav aria-label="Breadcrumbs" className="mb-2">
			<ol className="flex flex-wrap items-center gap-y-1">
				<li className="flex items-center">
					<Link
						href="/"
						prefetch={false}
						aria-label="Home page"
						className={`${pill} text-faint hover:bg-white/5 hover:text-accent`}
					>
						<House aria-hidden size={17} className="inline" />
					</Link>
				</li>
				{crumbs.map((crumb, i) => {
					const last = i === crumbs.length - 1;
					return (
						<li key={`${crumb.label}-${i}`} className="flex items-center">
							<ChevronRight
								aria-hidden
								size={14}
								className="mx-0.5 text-muted opacity-35"
							/>
							{last ? (
								<span
									aria-current="page"
									className={`${pill} bg-white/5 font-medium text-accent`}
								>
									{crumb.label}
								</span>
							) : crumb.href ? (
								<Link
									href={crumb.href}
									className={`${pill} text-faint hover:bg-white/5 hover:text-accent`}
								>
									{crumb.label}
								</Link>
							) : (
								<span className={`${pill} text-faint`}>{crumb.label}</span>
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
		<div className="mt-12">
			<a
				href={href}
				target="_blank"
				rel="noopener noreferrer"
				className="inline-flex items-center gap-1.5 text-[0.8125rem] text-faint transition-colors hover:text-accent"
			>
				<SquarePen aria-hidden size={15} />
				Edit this page
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
		"block rounded-lg border border-line bg-surface p-4 leading-tight transition-colors hover:border-faint hover:bg-surface-hover";
	return (
		<nav aria-label="Docs pages" className="mt-8 grid grid-cols-2 gap-4">
			{previous ? (
				<Link href={previous.href} className={card}>
					<div className="mb-1 text-xs uppercase tracking-[0.05em] text-faint">
						Previous
					</div>
					<div className="font-medium text-fg">« {previous.label}</div>
				</Link>
			) : (
				<span />
			)}
			{next ? (
				<Link href={next.href} className={`${card} col-start-2 text-right`}>
					<div className="mb-1 text-xs uppercase tracking-[0.05em] text-faint">
						Next
					</div>
					<div className="font-medium text-fg">{next.label} »</div>
				</Link>
			) : null}
		</nav>
	);
}
