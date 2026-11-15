import type { NextConfig } from "next";

/**
 * Fully static export (`out/`) served by GitHub Pages at
 * https://toby.iwonderdesigns.com. No trailing slashes so existing
 * `/docs/<page>` URLs keep resolving to `<page>.html`.
 */
const nextConfig: NextConfig = {
	output: "export",
	trailingSlash: false,
	images: { unoptimized: true },
	reactStrictMode: true,
};

export default nextConfig;
