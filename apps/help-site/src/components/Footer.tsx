import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

type FooterLink = { readonly label: string; readonly href: string };

const GITHUB = "https://github.com/kshehadeh/toby";

const columns: readonly { title: string; items: readonly FooterLink[] }[] = [
	{
		title: "Product",
		items: [
			{ label: "Features", href: "/#features" },
			{ label: "Sources", href: "/#integrations" },
			{ label: "Privacy", href: "/#privacy" },
			{ label: "Download", href: "/docs/getting-started/install" },
		],
	},
	{
		title: "Docs",
		items: [
			{ label: "Welcome to Toby", href: "/docs/intro" },
			{ label: "Getting started", href: "/docs/getting-started/install" },
			{ label: "Things to try", href: "/docs/examples" },
			{ label: "Security", href: "/docs/security" },
			{ label: "How Toby works", href: "/docs/architecture/overview" },
		],
	},
	{
		title: "Project",
		items: [
			{ label: "GitHub", href: GITHUB },
			{ label: "Releases", href: `${GITHUB}/releases` },
			{ label: "Report an issue", href: `${GITHUB}/issues` },
		],
	},
];

const linkClass =
	"inline-flex items-center gap-1 text-[0.8125rem] leading-7 text-muted transition-colors hover:text-fg";

const badges = [
	{
		href: "https://betalist.com/startups/toby?utm_campaign=badge-toby&utm_medium=badge&utm_source=badge-featured",
		src: "https://betalist.com/badges/featured?id=180938&theme=dark",
		alt: "Toby on BetaList",
		className: "h-9 w-auto",
	},
	{
		href: "https://buildlist.io",
		src: "https://buildlist.io/badge.svg",
		alt: "Featured on Buildlist",
		className: "h-8 w-auto",
	},
] as const;

export function Footer() {
	return (
		<footer className="border-t border-line-subtle bg-canvas">
			<div className="mx-auto max-w-[1200px] px-4 py-14 sm:px-6">
				<div className="grid grid-cols-2 gap-8 md:grid-cols-[1.4fr_repeat(4,1fr)]">
					<div className="col-span-2 md:col-span-1">
						<Link href="/" className="inline-flex items-center gap-2">
							<img
								src="/img/128x128.png"
								alt=""
								width={22}
								height={22}
								className="size-[22px]"
							/>
							<span className="text-sm font-semibold text-fg">Toby</span>
						</Link>
						<p className="mt-3 max-w-[16rem] text-[0.8125rem] leading-relaxed text-faint">
							A native AI assistant for your Mac.
						</p>
						<div className="mt-5 flex flex-wrap items-center gap-3 opacity-70 transition-opacity hover:opacity-100">
							{badges.map((badge) => (
								<a
									key={badge.href}
									href={badge.href}
									target="_blank"
									rel="noopener noreferrer"
								>
									<img
										src={badge.src}
										alt={badge.alt}
										className={badge.className}
									/>
								</a>
							))}
						</div>
					</div>
					{columns.map((column) => (
						<div key={column.title}>
							<div className="mb-3 text-[0.8125rem] font-medium text-fg">
								{column.title}
							</div>
							<ul>
								{column.items.map((item) => (
									<li key={item.label}>
										{item.href.startsWith("/") ? (
											<Link href={item.href} className={linkClass}>
												{item.label}
											</Link>
										) : (
											<a
												href={item.href}
												target="_blank"
												rel="noopener noreferrer"
												className={linkClass}
											>
												{item.label}
												<ArrowUpRight aria-hidden size={12} />
											</a>
										)}
									</li>
								))}
							</ul>
						</div>
					))}
				</div>
				<div className="mt-12 border-t border-line-subtle pt-6 text-xs text-faint">
					© {new Date().getFullYear()} Toby
				</div>
			</div>
		</footer>
	);
}
