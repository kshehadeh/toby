import type {
	DashboardBlockContentItem,
	DashboardBlockContentSection,
} from "./types";

type MutableSection = {
	eyebrow?: string;
	title?: string;
	bodyLines: string[];
	items: DashboardBlockContentItem[];
};

const headingPattern = /^\s{0,3}(#{1,3})\s+(.+?)\s*#*\s*$/;
const listPattern = /^\s*(?:[-*]|•)\s+(.+?)\s*$/;
const markdownLinkPattern = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/;

function plainInlineMarkdown(value: string): string {
	return value
		.replace(markdownLinkPattern, "$1")
		.replace(/(\*\*|__)(.*?)\1/g, "$2")
		.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1")
		.replace(/(?<!_)_([^_]+)_(?!_)/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.trim();
}

function parseItem(raw: string): DashboardBlockContentItem {
	const link = raw.match(markdownLinkPattern);
	const emphasizedLead = raw.match(/^\*\*(.+?)\*\*:?\s*(.*)$/);
	if (emphasizedLead?.[1]) {
		const subtitle = plainInlineMarkdown(emphasizedLead[2] ?? "").replace(
			/^[:—–-]\s*/,
			"",
		);
		return {
			title: plainInlineMarkdown(emphasizedLead[1]).replace(/:$/, ""),
			...(subtitle ? { subtitle } : {}),
			...(link?.[2] ? { url: link[2] } : {}),
		};
	}
	const withoutLink = plainInlineMarkdown(raw);
	const parts = withoutLink.split(/\s+(?:—|–)\s+/, 2);
	const title = parts[0]?.trim() || withoutLink;
	const subtitle = parts[1]?.trim();
	return {
		title,
		...(subtitle ? { subtitle } : {}),
		...(link?.[2] ? { url: link[2] } : {}),
	};
}

function hasContent(section: MutableSection): boolean {
	return Boolean(
		section.eyebrow ||
			section.title ||
			section.bodyLines.some((line) => line.trim()) ||
			section.items.length,
	);
}

function finishSection(
	section: MutableSection,
	index: number,
): DashboardBlockContentSection | null {
	if (!hasContent(section)) return null;
	const body = section.bodyLines.join("\n").trim();
	return {
		id: `section-${index}`,
		...(section.eyebrow ? { eyebrow: section.eyebrow } : {}),
		...(section.title ? { title: section.title } : {}),
		...(body ? { body } : {}),
		items: section.items,
	};
}

/**
 * Convert predictable Markdown hierarchy into an optional client-friendly
 * structure. Ambiguous/plain output returns no sections so clients render the
 * original Markdown unchanged.
 */
export function dashboardContentSections(
	markdown: string,
): readonly DashboardBlockContentSection[] | undefined {
	const lines = markdown.trim().split(/\r?\n/);
	if (
		!markdown.trim() ||
		!lines.some((line) => headingPattern.test(line) || listPattern.test(line))
	) {
		return undefined;
	}

	const result: DashboardBlockContentSection[] = [];
	let current: MutableSection = { bodyLines: [], items: [] };

	const flush = () => {
		const section = finishSection(current, result.length);
		if (section) result.push(section);
		current = { bodyLines: [], items: [] };
	};

	for (const line of lines) {
		const heading = line.match(headingPattern);
		if (heading) {
			const level = heading[1]?.length ?? 0;
			const text = plainInlineMarkdown(heading[2] ?? "");
			if (level === 2) {
				flush();
				current.eyebrow = text;
			} else if (!current.title) {
				current.title = text;
			} else {
				flush();
				current.title = text;
			}
			continue;
		}

		const item = line.match(listPattern);
		if (item?.[1]) {
			current.items.push(parseItem(item[1]));
			continue;
		}
		current.bodyLines.push(line);
	}
	flush();

	return result.length ? result : undefined;
}
