import { Sidebar } from "@/components/Sidebar";
import { getNavTree } from "@/lib/docs";
import type { ReactNode } from "react";

export default function DocsLayout({
	children,
}: { readonly children: ReactNode }) {
	return (
		<div className="flex w-full flex-1">
			<aside className="hidden w-[300px] shrink-0 border-r border-line-subtle bg-surface lg:block">
				<div className="sticky top-navbar max-h-[calc(100vh-var(--spacing-navbar))] overflow-y-auto">
					<Sidebar nodes={getNavTree()} />
				</div>
			</aside>
			<main className="min-w-0 flex-1">{children}</main>
		</div>
	);
}
