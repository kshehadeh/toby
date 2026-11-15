import { SITE, docHref, getAllDocs } from "@/lib/docs";
import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
	return [
		{ url: SITE.url, changeFrequency: "weekly", priority: 0.8 },
		{ url: `${SITE.url}/docs`, changeFrequency: "weekly", priority: 0.6 },
		...[...getAllDocs().keys()].sort().map((id) => ({
			url: `${SITE.url}${docHref(id)}`,
			changeFrequency: "weekly" as const,
			priority: 0.5,
		})),
	];
}
