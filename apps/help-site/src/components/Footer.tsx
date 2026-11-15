import { ExternalLink } from "lucide-react";
import Link from "next/link";

type FooterLink = { readonly label: string; readonly href: string };

const columns: readonly { title: string; items: readonly FooterLink[] }[] = [
	{
		title: "Help",
		items: [
			{ label: "Welcome to Toby", href: "/docs/intro" },
			{ label: "Getting Started", href: "/docs/getting-started/install" },
			{ label: "Integrations", href: "/docs/integrations/overview" },
			{ label: "Things to try", href: "/docs/examples" },
		],
	},
	{
		title: "Project",
		items: [
			{ label: "GitHub", href: "https://github.com/kshehadeh/toby" },
			{ label: "Releases", href: "https://github.com/kshehadeh/toby/releases" },
		],
	},
];

const linkClass =
	"text-sm leading-8 text-muted transition-colors hover:text-accent hover:underline";

export function Footer() {
	return (
		<footer className="border-t border-line-subtle bg-toby-black py-10">
			<div className="mx-auto max-w-[1140px] px-4">
				<div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
					{columns.map((column) => (
						<div key={column.title}>
							<div className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-faint">
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
												className={`${linkClass} inline-flex items-center gap-1`}
											>
												{item.label}
												<ExternalLink aria-hidden size={13} />
											</a>
										)}
									</li>
								))}
							</ul>
						</div>
					))}
				</div>
				<div className="mt-6 text-center text-[0.8125rem] text-faint">
					Copyright © {new Date().getFullYear()} Toby.
				</div>
			</div>
		</footer>
	);
}
