"use client";

import { useEffect } from "react";

/**
 * Marks `[data-reveal]` and `.hero-shot` elements with `data-visible` as they
 * scroll into view. Rendered once per page; the CSS in globals.css does the
 * animation and skips it under Reduce Motion.
 */
export function ScrollReveal() {
	useEffect(() => {
		const targets = document.querySelectorAll<HTMLElement>(
			"[data-reveal], .hero-shot",
		);
		if (!("IntersectionObserver" in window)) {
			for (const el of targets) el.dataset.visible = "";
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					(entry.target as HTMLElement).dataset.visible = "";
					observer.unobserve(entry.target);
				}
			},
			{ rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
		);
		for (const el of targets) observer.observe(el);
		return () => observer.disconnect();
	}, []);
	return null;
}
