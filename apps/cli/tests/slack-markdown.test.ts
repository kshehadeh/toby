import { describe, expect, it } from "vitest";
import {
	buildMrkdwnSectionBlocks,
	markdownToMrkdwn,
	stripMarkdownForPlainFallback,
	truncateSlackMarkdown,
} from "../../plugin-slack/src/slack-markdown";

describe("slack markdown formatting", () => {
	it("converts common GFM to mrkdwn", () => {
		expect(markdownToMrkdwn("**bold** and [link](https://x.test)")).toBe(
			"*bold* and <https://x.test|link>",
		);
		expect(markdownToMrkdwn("## Heading")).toBe("*Heading*");
	});

	it("strips markdown for plain fallback", () => {
		expect(stripMarkdownForPlainFallback("**Hi** [docs](https://x.test)")).toBe(
			"Hi docs",
		);
	});

	it("truncates long markdown_text payloads", () => {
		const long = "a".repeat(12_001);
		const out = truncateSlackMarkdown(long);
		expect(out.length).toBeLessThanOrEqual(12_000);
		expect(out).toContain("truncated");
	});

	it("builds section blocks JSON", () => {
		const blocks = JSON.parse(buildMrkdwnSectionBlocks("**Hello**")) as Array<{
			type: string;
			text: { type: string; text: string };
		}>;
		expect(blocks[0]?.type).toBe("section");
		expect(blocks[0]?.text.type).toBe("mrkdwn");
		expect(blocks[0]?.text.text).toBe("*Hello*");
	});
});
