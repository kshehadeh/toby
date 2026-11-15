import type { Metadata } from "next";

export const metadata: Metadata = { title: "Page Not Found" };

export default function NotFound() {
	return (
		<main className="mx-auto w-full max-w-xl px-4 py-16">
			<h1 className="mb-4 text-5xl font-bold tracking-[-0.025em] text-fg">
				Page Not Found
			</h1>
			<p className="mb-5 leading-[1.7]">
				We could not find what you were looking for.
			</p>
			<p className="leading-[1.7]">
				Please contact the owner of the site that linked you to the original URL
				and let them know their link is broken.
			</p>
		</main>
	);
}
