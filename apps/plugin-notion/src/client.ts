import { Client } from "@notionhq/client";

type JsonRecord = Record<string, unknown>;

const NOTION_VERSION = "2026-03-11";
const PAGE_SIZE_MAX = 100;
const FETCH_MAX_PAGES = 20;
const RICH_TEXT_CHUNK_SIZE = 1900;

export interface NotionSearchResult {
	readonly id: string;
	readonly object: string;
	readonly title: string;
	readonly url?: string;
	readonly createdTime?: string;
	readonly lastEditedTime?: string;
}

export interface NotionBlockSummary {
	readonly id: string;
	readonly type: string;
	readonly hasChildren: boolean;
	readonly text?: string;
}

export function hasNotionApiKey(config: JsonRecord): boolean {
	return Boolean(String(config.apiKey ?? "").trim());
}

export function normalizeConfig(config: JsonRecord): JsonRecord {
	return {
		apiKey: String(config.apiKey ?? "").trim(),
		defaultParentPageId: normalizePageId(config.defaultParentPageId),
	};
}

export async function testNotionConnection(config: JsonRecord): Promise<void> {
	const client = getNotionClient(config);
	await client.users.me({});
}

export async function searchNotion(
	config: JsonRecord,
	query: string,
	limit: number,
): Promise<NotionSearchResult[]> {
	const client = getNotionClient(config);
	const collected: NotionSearchResult[] = [];
	let cursor: string | undefined;
	const normalizedLimit = normalizeLimit(limit, 10);

	for (
		let page = 0;
		page < FETCH_MAX_PAGES && collected.length < normalizedLimit;
		page++
	) {
		const pageSize = Math.min(
			PAGE_SIZE_MAX,
			normalizedLimit - collected.length,
		);
		const response = await client.search({
			query,
			page_size: pageSize,
			...(cursor ? { start_cursor: cursor } : {}),
		});
		for (const result of response.results ?? []) {
			collected.push(summarizeSearchResult(result as JsonRecord));
			if (collected.length >= normalizedLimit) break;
		}
		if (!response.has_more || !response.next_cursor) break;
		cursor = response.next_cursor;
	}

	return collected;
}

export async function getNotionPage(
	config: JsonRecord,
	pageId: string,
): Promise<JsonRecord> {
	const client = getNotionClient(config);
	const page = await client.pages.retrieve({
		page_id: requireString(pageId, "pageId"),
	});
	return summarizePage(page as JsonRecord);
}

export async function listNotionBlockChildren(
	config: JsonRecord,
	blockId: string,
	limit: number,
): Promise<{
	blocks: NotionBlockSummary[];
	hasMore: boolean;
	nextCursor?: string;
}> {
	const client = getNotionClient(config);
	const collected: NotionBlockSummary[] = [];
	let cursor: string | undefined;
	const normalizedLimit = normalizeLimit(limit, 30);
	let hasMore = false;
	let nextCursor: string | undefined;

	for (
		let page = 0;
		page < FETCH_MAX_PAGES && collected.length < normalizedLimit;
		page++
	) {
		const pageSize = Math.min(
			PAGE_SIZE_MAX,
			normalizedLimit - collected.length,
		);
		const response = await client.blocks.children.list({
			block_id: requireString(blockId, "blockId"),
			page_size: pageSize,
			...(cursor ? { start_cursor: cursor } : {}),
		});
		for (const block of response.results ?? []) {
			collected.push(summarizeBlock(block as JsonRecord));
			if (collected.length >= normalizedLimit) break;
		}
		hasMore = Boolean(response.has_more);
		nextCursor = response.next_cursor ?? undefined;
		if (!response.has_more || !response.next_cursor) break;
		cursor = response.next_cursor;
	}

	return {
		blocks: collected,
		hasMore,
		...(nextCursor ? { nextCursor } : {}),
	};
}

export async function createNotionPage(
	config: JsonRecord,
	input: {
		readonly title: string;
		readonly markdown: string;
		readonly parentPageId?: string;
	},
): Promise<JsonRecord> {
	const client = getNotionClient(config);
	const parentPageId = resolveParentPageId(config, input.parentPageId);
	const page = await client.pages.create({
		parent: { page_id: parentPageId },
		properties: {
			title: {
				title: [
					{
						type: "text",
						text: { content: requireString(input.title, "title") },
					},
				],
			},
		},
		children: markdownToBlocks(input.markdown),
	} as never);
	return summarizePage(page as JsonRecord);
}

export async function appendNotionPageContent(
	config: JsonRecord,
	pageId: string,
	markdown: string,
): Promise<{ blockId: string; appendedBlocks: number }> {
	const client = getNotionClient(config);
	const children = markdownToBlocks(markdown);
	await client.blocks.children.append({
		block_id: requireString(pageId, "pageId"),
		children,
	} as never);
	return {
		blockId: pageId,
		appendedBlocks: children.length,
	};
}

export function resolveParentPageId(
	config: JsonRecord,
	parentPageId?: unknown,
): string {
	const explicit = normalizePageId(parentPageId);
	if (explicit) return explicit;
	const configured = normalizePageId(config.defaultParentPageId);
	if (configured) return configured;
	throw new Error(
		"Notion page creation requires parentPageId or configured defaultParentPageId.",
	);
}

export function normalizeLimit(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(PAGE_SIZE_MAX, Math.max(1, Math.floor(value)));
}

export function normalizePageId(value: unknown): string {
	if (typeof value !== "string") return "";
	return value.trim();
}

function getNotionClient(config: JsonRecord): Client {
	const apiKey = String(config.apiKey ?? "").trim();
	if (!apiKey) {
		throw new Error(
			"Notion API key not found. Add it in `toby configure` under Notion.",
		);
	}
	return new Client({ auth: apiKey, notionVersion: NOTION_VERSION });
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${field} is required.`);
	}
	return value.trim();
}

function summarizeSearchResult(result: JsonRecord): NotionSearchResult {
	return {
		id: String(result.id ?? ""),
		object: String(result.object ?? ""),
		title: extractTitle(result) || "Untitled",
		...(typeof result.url === "string" ? { url: result.url } : {}),
		...(typeof result.created_time === "string"
			? { createdTime: result.created_time }
			: {}),
		...(typeof result.last_edited_time === "string"
			? { lastEditedTime: result.last_edited_time }
			: {}),
	};
}

function summarizePage(page: JsonRecord): JsonRecord {
	return {
		id: String(page.id ?? ""),
		object: String(page.object ?? ""),
		title: extractTitle(page) || "Untitled",
		...(typeof page.url === "string" ? { url: page.url } : {}),
		...(typeof page.created_time === "string"
			? { createdTime: page.created_time }
			: {}),
		...(typeof page.last_edited_time === "string"
			? { lastEditedTime: page.last_edited_time }
			: {}),
	};
}

function summarizeBlock(block: JsonRecord): NotionBlockSummary {
	const type = String(block.type ?? "unknown");
	const typed = block[type];
	const typedRecord =
		typed && typeof typed === "object" && !Array.isArray(typed)
			? (typed as JsonRecord)
			: {};
	return {
		id: String(block.id ?? ""),
		type,
		hasChildren: block.has_children === true,
		...(extractRichTextPlainText(typedRecord.rich_text).trim()
			? { text: extractRichTextPlainText(typedRecord.rich_text).trim() }
			: {}),
	};
}

function extractTitle(obj: JsonRecord): string {
	const properties = obj.properties;
	if (
		!properties ||
		typeof properties !== "object" ||
		Array.isArray(properties)
	) {
		return "";
	}
	for (const value of Object.values(properties as JsonRecord)) {
		if (!value || typeof value !== "object" || Array.isArray(value)) continue;
		const prop = value as JsonRecord;
		if (prop.type === "title") {
			return extractRichTextPlainText(prop.title).trim();
		}
	}
	return "";
}

function extractRichTextPlainText(value: unknown): string {
	if (!Array.isArray(value)) return "";
	return value
		.map((entry) => {
			if (!entry || typeof entry !== "object") return "";
			const record = entry as JsonRecord;
			return typeof record.plain_text === "string" ? record.plain_text : "";
		})
		.join("");
}

function richText(content: string): Array<JsonRecord> {
	const normalized = content.trimEnd();
	if (!normalized) {
		return [{ type: "text", text: { content: " " } }];
	}
	const chunks: string[] = [];
	for (let i = 0; i < normalized.length; i += RICH_TEXT_CHUNK_SIZE) {
		chunks.push(normalized.slice(i, i + RICH_TEXT_CHUNK_SIZE));
	}
	return chunks.map((chunk) => ({ type: "text", text: { content: chunk } }));
}

export function markdownToBlocks(markdown: string): Array<JsonRecord> {
	const text = requireString(markdown, "markdown");
	const blocks: JsonRecord[] = [];
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	let paragraph: string[] = [];
	let codeLines: string[] | null = null;

	function flushParagraph() {
		const content = paragraph.join("\n").trim();
		if (content) {
			blocks.push({
				object: "block",
				type: "paragraph",
				paragraph: { rich_text: richText(content) },
			});
		}
		paragraph = [];
	}

	for (const line of lines) {
		if (line.trim().startsWith("```")) {
			if (codeLines) {
				blocks.push({
					object: "block",
					type: "code",
					code: {
						language: "plain text",
						rich_text: richText(codeLines.join("\n")),
					},
				});
				codeLines = null;
			} else {
				flushParagraph();
				codeLines = [];
			}
			continue;
		}

		if (codeLines) {
			codeLines.push(line);
			continue;
		}

		if (!line.trim()) {
			flushParagraph();
			continue;
		}

		const heading = /^(#{1,3})\s+(.+)$/.exec(line);
		if (heading) {
			flushParagraph();
			const level = heading[1]?.length ?? 1;
			const type = `heading_${level}`;
			blocks.push({
				object: "block",
				type,
				[type]: { rich_text: richText(heading[2] ?? "") },
			});
			continue;
		}

		const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
		if (bullet) {
			flushParagraph();
			blocks.push({
				object: "block",
				type: "bulleted_list_item",
				bulleted_list_item: { rich_text: richText(bullet[1] ?? "") },
			});
			continue;
		}

		const numbered = /^\s*\d+\.\s+(.+)$/.exec(line);
		if (numbered) {
			flushParagraph();
			blocks.push({
				object: "block",
				type: "numbered_list_item",
				numbered_list_item: { rich_text: richText(numbered[1] ?? "") },
			});
			continue;
		}

		paragraph.push(line);
	}

	if (codeLines) {
		blocks.push({
			object: "block",
			type: "code",
			code: {
				language: "plain text",
				rich_text: richText(codeLines.join("\n")),
			},
		});
	}
	flushParagraph();

	return blocks.length > 0
		? blocks
		: [
				{
					object: "block",
					type: "paragraph",
					paragraph: { rich_text: richText(text) },
				},
			];
}
