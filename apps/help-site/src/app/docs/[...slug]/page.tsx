import { Breadcrumbs, EditThisPage, Pagination } from "@/components/DocChrome";
import { Toc, TocMobile } from "@/components/Toc";
import { mdxComponents } from "@/components/mdx";
import { SITE, getAllDocs, getDoc, getDocNav } from "@/lib/docs";
import { compileDoc } from "@/lib/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

type Params = { slug: string[] };

export const dynamicParams = false;

export function generateStaticParams(): Params[] {
	return [...getAllDocs().keys()].map((id) => ({ slug: id.split("/") }));
}

export async function generateMetadata({
	params,
}: { params: Promise<Params> }): Promise<Metadata> {
	const doc = getDoc((await params).slug.join("/"));
	if (!doc) return {};
	return {
		title: doc.title,
		description: doc.description,
		alternates: { canonical: `/docs/${doc.id}` },
	};
}

export default async function DocPage({ params }: { params: Promise<Params> }) {
	const doc = getDoc((await params).slug.join("/"));
	if (!doc) notFound();

	const { content: Content, toc } = await compileDoc(doc);
	const nav = getDocNav(doc.id);

	return (
		<div className="mx-auto flex w-full max-w-[1320px] px-4 pt-2 pb-8 lg:pt-4">
			<div className="min-w-0 flex-1 lg:max-w-3/4">
				<Breadcrumbs crumbs={nav.breadcrumbs} />
				<TocMobile toc={toc} />
				<article className="max-w-3xl pt-2">
					<Content components={mdxComponents} />
				</article>
				<EditThisPage href={`${SITE.editBase}${doc.id}.mdx`} />
				<Pagination previous={nav.previous} next={nav.next} />
			</div>
			<div className="hidden w-1/4 shrink-0 px-4 lg:block">
				<Toc toc={toc} />
			</div>
		</div>
	);
}
