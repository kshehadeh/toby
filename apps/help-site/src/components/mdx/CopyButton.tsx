"use client";

import { Check, Copy } from "lucide-react";
import { useRef, useState } from "react";

/** Copies the text of the sibling `<pre>` in the enclosing code block. */
export function CopyButton() {
	const ref = useRef<HTMLButtonElement>(null);
	const [copied, setCopied] = useState(false);

	async function copy() {
		const pre = ref.current?.closest("[data-code-block]")?.querySelector("pre");
		if (!pre) return;
		try {
			await navigator.clipboard.writeText(pre.innerText.replace(/\n$/, ""));
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			/* clipboard unavailable */
		}
	}

	return (
		<button
			ref={ref}
			type="button"
			onClick={copy}
			aria-label={copied ? "Copied" : "Copy code to clipboard"}
			title="Copy"
			className="absolute top-2.5 right-2.5 inline-flex size-7 items-center justify-center rounded-md border border-line bg-surface-raised/90 text-muted backdrop-blur opacity-0 transition hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
		>
			{copied ? (
				<Check size={14} className="text-emerald-400" />
			) : (
				<Copy size={14} />
			)}
		</button>
	);
}
