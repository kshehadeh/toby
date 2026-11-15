"use client";

import Link from "next/link";
import type { PointerEvent, ReactNode } from "react";

/** Bento tile whose hover highlight follows the pointer. */
export function SpotlightCard({
	href,
	className = "",
	children,
}: {
	readonly href: string;
	readonly className?: string;
	readonly children: ReactNode;
}) {
	function track(event: PointerEvent<HTMLAnchorElement>) {
		const rect = event.currentTarget.getBoundingClientRect();
		event.currentTarget.style.setProperty(
			"--x",
			`${event.clientX - rect.left}px`,
		);
		event.currentTarget.style.setProperty(
			"--y",
			`${event.clientY - rect.top}px`,
		);
	}

	return (
		<Link
			href={href}
			onPointerMove={track}
			className={`spotlight group flex flex-col overflow-hidden rounded-2xl border border-line bg-surface transition-colors duration-200 hover:border-line-strong ${className}`}
		>
			{children}
		</Link>
	);
}
