import { cn } from "@/lib/utils";
import {
	useCallback,
	useEffect,
	useRef,
	type ReactNode,
} from "react";

const SCROLLBAR_HIDE_DELAY_MS = 900;

/** Sidebar body with native overflow; scrollbar appears only while scrolling. */
export function SidebarScrollPanel({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	const panelRef = useRef<HTMLDivElement>(null);
	const hideTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);

	const revealScrollbar = useCallback(() => {
		const panel = panelRef.current;
		if (!panel) return;
		panel.dataset.scrolling = "true";
		clearTimeout(hideTimerRef.current);
		hideTimerRef.current = setTimeout(() => {
			delete panel.dataset.scrolling;
		}, SCROLLBAR_HIDE_DELAY_MS);
	}, []);

	useEffect(() => {
		const panel = panelRef.current;
		if (!panel) return;

		panel.addEventListener("scroll", revealScrollbar, { passive: true });
		panel.addEventListener("wheel", revealScrollbar, { passive: true });

		return () => {
			panel.removeEventListener("scroll", revealScrollbar);
			panel.removeEventListener("wheel", revealScrollbar);
			clearTimeout(hideTimerRef.current);
		};
	}, [revealScrollbar]);

	return (
		<div
			ref={panelRef}
			className={cn(
				"overlay-scrollbar flex-1 min-h-0 overflow-y-auto overscroll-contain",
				className,
			)}
		>
			{children}
		</div>
	);
}
