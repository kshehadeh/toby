import { Footer } from "@/components/Footer";
import { Navbar } from "@/components/Navbar";
import { SITE, getNavTree } from "@/lib/docs";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const inter = Inter({
	subsets: ["latin"],
	weight: ["400", "500", "600", "700"],
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
	themeColor: "#000000",
	colorScheme: "dark",
};

export default function RootLayout({
	children,
}: { readonly children: ReactNode }) {
	return (
		<html lang="en" className={inter.variable}>
			<body className="flex min-h-screen flex-col">
				<Navbar nav={getNavTree()} />
				<div className="flex flex-1 flex-col">{children}</div>
				<Footer />
			</body>
		</html>
	);
}
