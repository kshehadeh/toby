/** Slack `markdown_text` field limit (chat.postMessage). */
export const SLACK_MARKDOWN_TEXT_MAX = 12_000;

/** Max characters per `mrkdwn` section block. */
export const SLACK_MRKDWN_BLOCK_MAX = 3000;

export function truncateSlackMarkdown(text: string): string {
	if (text.length <= SLACK_MARKDOWN_TEXT_MAX) {
		return text;
	}
	return `${text.slice(0, SLACK_MARKDOWN_TEXT_MAX - 24)}\n\n… _(truncated)_`;
}

/**
 * Best-effort GFM → Slack mrkdwn for Block Kit fallback when `markdown_text` is unavailable.
 */
export function markdownToMrkdwn(text: string): string {
	let s = text;
	s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");
	s = s.replace(/\*\*(.+?)\*\*/g, "*$1*");
	s = s.replace(/__(.+?)__/g, "*$1*");
	s = s.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");
	s = s.replace(/~~(.+?)~~/g, "~$1~");
	return s;
}

/** Plain-text fallback for notifications and accessibility. */
export function stripMarkdownForPlainFallback(text: string): string {
	return text
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/\*\*(.+?)\*\*/g, "$1")
		.replace(/__(.+?)__/g, "$1")
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/~~(.+?)~~/g, "$1");
}

export function chunkText(text: string, maxLen: number): string[] {
	if (text.length <= maxLen) {
		return [text];
	}
	const chunks: string[] = [];
	let rest = text;
	while (rest.length > 0) {
		if (rest.length <= maxLen) {
			chunks.push(rest);
			break;
		}
		let splitAt = rest.lastIndexOf("\n", maxLen);
		if (splitAt < maxLen * 0.5) {
			splitAt = maxLen;
		}
		chunks.push(rest.slice(0, splitAt));
		rest = rest.slice(splitAt).trimStart();
	}
	return chunks;
}

export function buildMrkdwnSectionBlocks(text: string): string {
	const mrkdwn = markdownToMrkdwn(text);
	const chunks = chunkText(mrkdwn, SLACK_MRKDWN_BLOCK_MAX);
	const blocks = chunks.map((chunk) => ({
		type: "section",
		text: { type: "mrkdwn", text: chunk },
	}));
	return JSON.stringify(blocks);
}
