import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Docs", robots: { index: false } };

/** `/docs` has no page of its own; send readers to the introduction. */
export default function DocsIndex() {
	return (
		<>
			<meta httpEquiv="refresh" content="0; url=/docs/intro" />
			<div className="px-4 py-10">
				<Link
					href="/docs/intro"
					className="text-fg underline underline-offset-[3px] hover:text-accent"
				>
					Continue to Welcome to Toby →
				</Link>
			</div>
		</>
	);
}
