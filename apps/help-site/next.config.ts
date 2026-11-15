import type { NextConfig } from "next";

/**
 * Fully static export (`out/`) deployed to Vercel (project `toby-docs`) at
 * https://www.tobyai.app. No trailing slashes so existing
 * `/docs/<page>` URLs keep resolving to `<page>.html`.
 */
const nextConfig: NextConfig = {
	output: "export",
	trailingSlash: false,
	images: { unoptimized: true },
	reactStrictMode: true,
};

export default nextConfig;
