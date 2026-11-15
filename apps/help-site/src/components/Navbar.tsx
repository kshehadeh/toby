"use client";

import type { NavNode } from "@/lib/docs";
import { ArrowUpRight, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { DownloadTobyButton } from "./DownloadTobyButton";
import { Sidebar } from "./Sidebar";

const GITHUB = "https://github.com/kshehadeh/toby";

type NavLink = {
	readonly label: string;
	readonly href: string;
	readonly match?: string;
};

const links: readonly NavLink[] = [
	{ label: "Features", href: "/#features" },
	{ label: "Integrations", href: "/#integrations" },
	{ label: "Docs", href: "/docs", match: "/docs" },
	{ label: "Changelog", href: `${GITHUB}/releases` },
];

function Brand({ onClick }: { readonly onClick?: () => void }) {
	return (
		<Link
			href="/"
			prefetch={false}
			onClick={onClick}
			className="flex min-w-0 items-center gap-2"
		>
			<img
				src="/img/128x128.png"
				alt=""
				width={24}
				height={24}
				className="size-6 shrink-0"
			/>
			<span className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-fg">
				Toby
			</span>
		</Link>
	);
}

const itemClass =
	"inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[0.8125rem] text-muted transition-colors hover:text-fg";

function NavItem({
	link,
	active,
	onClick,
	className = itemClass,
}: {
	readonly link: NavLink;
	readonly active: boolean;
	readonly onClick?: () => void;
	readonly className?: string;
}) {
	const external = link.href.startsWith("http");
	if (external) {
		return (
			<a
				href={link.href}
				target="_blank"
				rel="noopener noreferrer"
				onClick={onClick}
				className={className}
			>
				{link.label}
				<ArrowUpRight aria-hidden size={12} className="opacity-60" />
			</a>
		);
	}
	return (
		<Link
			href={link.href}
			onClick={onClick}
			aria-current={active ? "page" : undefined}
			className={`${className} ${active ? "text-fg" : ""}`}
		>
			{link.label}
		</Link>
	);
}

/** Translucent sticky top bar; below the desktop breakpoint links and the docs tree move into a drawer. */
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
	const isActive = (link: NavLink) =>
		link.match ? pathname.startsWith(link.match) : false;

	return (
		<>
			<header className="sticky top-0 z-40 h-navbar border-b border-line-subtle bg-canvas/70 backdrop-blur-xl backdrop-saturate-150">
				<div
					className={`mx-auto flex h-full items-center px-4 ${inDocs ? "" : "max-w-[1200px] sm:px-6"}`}
				>
					<div className="flex flex-1 items-center">
						<Brand />
					</div>
					<nav aria-label="Main" className="hidden items-center lg:flex">
						{links.map((link) => (
							<NavItem key={link.label} link={link} active={isActive(link)} />
						))}
					</nav>
					<div className="flex flex-1 items-center justify-end gap-1">
						<span className="hidden lg:contents">
							<a
								href={GITHUB}
								target="_blank"
								rel="noopener noreferrer"
								className={itemClass}
							>
								GitHub
							</a>
						</span>
						<DownloadTobyButton
							compact
							size="sm"
							variant="primary"
							className="ml-1 hidden sm:inline-flex"
						/>
						<button
							type="button"
							aria-label="Open navigation"
							aria-expanded={open}
							onClick={() => setOpen(true)}
							className="ml-1 rounded-md p-1.5 text-fg hover:bg-white/5 lg:hidden"
						>
							<Menu size={20} />
						</button>
					</div>
				</div>
			</header>

			{open ? (
				<div className="fixed inset-0 z-50 lg:hidden">
					<button
						type="button"
						aria-label="Close navigation"
						onClick={close}
						className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm"
					/>
					<div className="absolute inset-y-0 right-0 flex w-[85vw] max-w-[22rem] flex-col border-l border-line bg-canvas shadow-2xl">
						<div className="flex h-navbar shrink-0 items-center justify-between border-b border-line-subtle px-4">
							<Brand onClick={close} />
							<button
								type="button"
								aria-label="Close navigation bar"
								onClick={close}
								className="rounded-md p-1.5 text-muted hover:bg-white/5 hover:text-fg"
							>
								<X size={20} />
							</button>
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto">
							<div className="flex flex-col gap-0.5 border-b border-line-subtle px-2 py-3">
								{links.map((link) => (
									<NavItem
										key={link.label}
										link={link}
										active={isActive(link)}
										onClick={close}
										className={`${itemClass} text-sm`}
									/>
								))}
								<NavItem
									link={{ label: "GitHub", href: GITHUB }}
									active={false}
									onClick={close}
									className={`${itemClass} text-sm`}
								/>
								<div className="px-3 pt-3 pb-1">
									<DownloadTobyButton size="md" className="w-full" />
								</div>
							</div>
							{inDocs ? <Sidebar nodes={nav} onNavigate={close} /> : null}
						</div>
					</div>
				</div>
			) : null}
		</>
	);
}
