"use client";

import { useEffect, useId, useRef, useState } from "react";

/** Renders a ```mermaid fence client-side with the dark theme. */
export function Mermaid({ chart }: { readonly chart: string }) {
	const ref = useRef<HTMLDivElement>(null);
	const id = `mermaid-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let cancelled = false;
		import("mermaid")
			.then(async ({ default: mermaid }) => {
				mermaid.initialize({
					startOnLoad: false,
					theme: "dark",
					fontFamily: "var(--font-sans)",
				});
				const { svg } = await mermaid.render(id, chart);
				if (!cancelled && ref.current) ref.current.innerHTML = svg;
			})
			.catch(() => {
				if (!cancelled) setFailed(true);
			});
		return () => {
			cancelled = true;
		};
	}, [chart, id]);

	if (failed) {
		return (
			<pre className="mb-5 overflow-x-auto rounded-lg border border-line bg-surface-raised p-4 text-sm">
				{chart}
			</pre>
		);
	}

	return (
		<div
			ref={ref}
			role="img"
			aria-label="Diagram"
			className="mb-5 flex min-h-24 justify-center [&_svg]:h-auto [&_svg]:max-w-full"
		/>
	);
}
