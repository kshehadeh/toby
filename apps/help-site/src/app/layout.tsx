import { Footer } from "@/components/Footer";
import { Navbar } from "@/components/Navbar";
import { SITE, getNavTree } from "@/lib/docs";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const inter = Inter({
	subsets: ["latin"],
	variable: "--font-inter",
	display: "swap",
	adjustFontFallback: false,
});

export const metadata: Metadata = {
	metadataBase: new URL(SITE.url),
	title: { default: SITE.title, template: `%s | ${SITE.title}` },
	description: SITE.tagline,
	icons: { icon: "/img/64x64.png" },
	openGraph: { images: ["/img/512x512.png"], siteName: SITE.title },
};

export const viewport: Viewport = {
	themeColor: "#08090a",
	colorScheme: "dark",
};

// Runs before paint so scroll-reveal content is only hidden when JS can show it.
const markJs = "document.documentElement.classList.add('js')";

export default function RootLayout({
	children,
}: { readonly children: ReactNode }) {
	return (
		<html lang="en" className={inter.variable} suppressHydrationWarning>
			<head>
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: static inline flag */}
				<script dangerouslySetInnerHTML={{ __html: markJs }} />
			</head>
			<body className="flex min-h-screen flex-col">
				<a
					href="#main"
					className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface-raised focus:px-3 focus:py-2 focus:text-fg"
				>
					Skip to content
				</a>
				<Navbar nav={getNavTree()} />
				<div id="main" className="flex flex-1 flex-col">
					{children}
				</div>
				<Footer />
			</body>
		</html>
	);
}
