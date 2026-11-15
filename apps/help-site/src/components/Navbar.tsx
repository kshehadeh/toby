"use client";

import type { NavNode } from "@/lib/docs";
import { ExternalLink, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";

const GITHUB = "https://github.com/kshehadeh/toby";

function Brand({ onClick }: { readonly onClick?: () => void }) {
	return (
		<Link
			href="/"
			prefetch={false}
			onClick={onClick}
			className="mr-4 flex min-w-0 items-center"
		>
			<img
				src="/img/128x128.png"
				alt="Toby"
				width={32}
				height={32}
				className="mr-2 size-8 shrink-0"
			/>
			<span className="text-[0.95rem] font-bold uppercase tracking-[0.06em] text-fg">
				Toby
			</span>
		</Link>
	);
}

const itemClass =
	"rounded-md px-[0.65rem] py-[0.35rem] text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-fg";

/** Sticky top bar; below the desktop breakpoint the docs sidebar moves into a drawer. */
export function Navbar({ nav }: { readonly nav: readonly NavNode[] }) {
	const pathname = usePathname() ?? "";
	const inDocs = pathname.startsWith("/docs");
	const [open, setOpen] = useState(false);

	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) =>
			event.key === "Escape" && setOpen(false);
		document.addEventListener("keydown", onKey);
		document.body.style.overflow = "hidden";
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = "";
		};
	}, [open]);

	const close = () => setOpen(false);

	return (
		<>
			<header className="sticky top-0 z-40 h-navbar border-b border-line-subtle bg-[#242526] px-2 shadow-[0_1px_2px_0_rgba(0,0,0,0.1)] lg:backdrop-blur-md">
				<div className="flex h-full items-center">
					<button
						type="button"
						aria-label="Toggle navigation bar"
						aria-expanded={open}
						onClick={() => setOpen(true)}
						className="mr-2 rounded-md p-1.5 text-fg hover:bg-surface-hover lg:hidden"
					>
						<Menu size={22} />
					</button>
					<Brand />
					<nav aria-label="Main" className="hidden items-center lg:flex">
						<Link
							href="/docs/intro"
							className={
								inDocs
									? "rounded-none border-b-2 border-fg px-[0.65rem] pt-[0.35rem] pb-[calc(0.35rem-2px)] text-sm font-medium text-fg"
									: itemClass
							}
						>
							Docs
						</Link>
					</nav>
					<div className="ml-auto hidden lg:flex">
						<a
							href={GITHUB}
							target="_blank"
							rel="noopener noreferrer"
							className={`${itemClass} inline-flex items-center gap-1`}
						>
							GitHub
							<ExternalLink aria-hidden size={13} />
						</a>
					</div>
				</div>
			</header>

			{open ? (
				<div className="fixed inset-0 z-50 lg:hidden">
					<button
						type="button"
						aria-label="Close navigation"
						onClick={close}
						className="absolute inset-0 cursor-default bg-black/70"
					/>
					<div className="absolute inset-y-0 left-0 flex w-[83vw] max-w-[20rem] flex-col bg-toby-black shadow-2xl">
						<div className="flex h-navbar shrink-0 items-center justify-between border-b border-line-subtle px-4">
							<Brand onClick={close} />
							<button
								type="button"
								aria-label="Close navigation bar"
								onClick={close}
								className="rounded-md p-1.5 text-muted hover:bg-surface-hover hover:text-fg"
							>
								<X size={20} />
							</button>
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto">
							<div className="flex flex-col gap-1 border-b border-line-subtle px-2 py-3">
								<Link href="/docs/intro" onClick={close} className={itemClass}>
									Docs
								</Link>
								<a
									href={GITHUB}
									target="_blank"
									rel="noopener noreferrer"
									className={`${itemClass} inline-flex items-center gap-1`}
								>
									GitHub
									<ExternalLink aria-hidden size={13} />
								</a>
							</div>
							<Sidebar nodes={nav} onNavigate={close} />
						</div>
					</div>
				</div>
			) : null}
		</>
	);
}
