import { afterEach, describe, expect, it } from "bun:test";
import type { CoreMessage } from "@toby/core/ai/chat";
import {
	SUPERSEDED_TOOL_RESULT_PLACEHOLDER,
	applyTieredCompaction,
	clampOversizedMessages,
	clearOldToolResults,
	countOrphanToolParts,
	dedupeSupersededToolResults,
	estimateMessagesTokens,
	estimateTextTokens,
	resolveCompactionConfig,
	resultKey,
} from "@toby/core/chat-pipeline/compaction";

afterEach(() => {
	Reflect.deleteProperty(process.env, "TOBY_COMPACTION_TARGET_RATIO");
});

function toolCall(
	id: string,
	name: string,
	input: unknown = {},
): {
	type: "tool-call";
	toolCallId: string;
	toolName: string;
	input: unknown;
} {
	return { type: "tool-call", toolCallId: id, toolName: name, input };
}

function toolResult(
	id: string,
	name: string,
	value: string,
): {
	type: "tool-result";
	toolCallId: string;
	toolName: string;
	output: { type: "text"; value: string };
} {
	return {
		type: "tool-result",
		toolCallId: id,
		toolName: name,
		output: { type: "text", value },
	};
}

function bigPayload(chars: number): string {
	return "x".repeat(chars);
}

describe("estimate", () => {
	it("scales with text length", () => {
		expect(estimateTextTokens("abcd")).toBe(1);
		expect(estimateTextTokens("a".repeat(40))).toBe(10);
	});

	it("counts tool result bulk", () => {
		const small: CoreMessage[] = [
			{ role: "user", content: "hi" },
			{
				role: "assistant",
				content: [toolCall("1", "emailGet", { id: "m1" })],
			},
			{
				role: "tool",
				content: [toolResult("1", "emailGet", "short")],
			},
		];
		const large: CoreMessage[] = [
			{ role: "user", content: "hi" },
			{
				role: "assistant",
				content: [toolCall("1", "emailGet", { id: "m1" })],
			},
			{
				role: "tool",
				content: [toolResult("1", "emailGet", bigPayload(40_000))],
			},
		];
		expect(estimateMessagesTokens(large)).toBeGreaterThan(
			estimateMessagesTokens(small) * 10,
		);
	});
});

describe("clampOversizedMessages", () => {
	it("head/tail clamps oversized assistant text", () => {
		const huge = bigPayload(200_000); // ~50k tokens
		const messages: CoreMessage[] = [
			{ role: "system", content: "sys" },
			{ role: "user", content: "go" },
			{ role: "assistant", content: huge },
		];
		const result = clampOversizedMessages(messages, {
			maxPartTokens: 10_000,
			keepHeadChars: 100,
			keepTailChars: 100,
		});
		expect(result.changed).toBe(true);
		expect(result.clampedParts).toBe(1);
		const assistant = result.messages[2];
		expect(assistant?.role).toBe("assistant");
		expect(typeof assistant?.content).toBe("string");
		const text = assistant?.content as string;
		expect(text).toContain("[clamped: removed");
		expect(text.length).toBeLessThan(huge.length);
		expect(text.startsWith("x".repeat(100))).toBe(true);
	});

	it("clamps oversized tool-call args into _clamped object", () => {
		const messages: CoreMessage[] = [
			{
				role: "assistant",
				content: [toolCall("c1", "writePlan", bigPayload(200_000))],
			},
		];
		const result = clampOversizedMessages(messages, {
			maxPartTokens: 5_000,
			keepHeadChars: 50,
			keepTailChars: 50,
		});
		expect(result.changed).toBe(true);
		const part = (result.messages[0]?.content as Array<{ input: unknown }>)[0];
		expect(part?.input).toEqual(
			expect.objectContaining({ _clamped: expect.any(String) }),
		);
	});

	it("does not rewrite user or system messages", () => {
		const huge = bigPayload(200_000);
		const messages: CoreMessage[] = [
			{ role: "system", content: huge },
			{ role: "user", content: huge },
		];
		const result = clampOversizedMessages(messages, {
			maxPartTokens: 100,
			keepHeadChars: 10,
			keepTailChars: 10,
		});
		expect(result.changed).toBe(false);
		expect(result.messages[0]?.content).toBe(huge);
		expect(result.messages[1]?.content).toBe(huge);
	});
});

describe("clearOldToolResults", () => {
	function historyWithToolResults(
		count: number,
		payloadChars: number,
	): CoreMessage[] {
		const messages: CoreMessage[] = [
			{ role: "system", content: "sys" },
			{ role: "user", content: "fetch things" },
		];
		for (let i = 0; i < count; i++) {
			const id = `t${i}`;
			messages.push({
				role: "assistant",
				content: [toolCall(id, "emailGet", { id: `m${i}` })],
			});
			messages.push({
				role: "tool",
				content: [toolResult(id, "emailGet", bigPayload(payloadChars))],
			});
		}
		return messages;
	}

	it("keeps the most recent keepPairs results intact", () => {
		const messages = historyWithToolResults(5, 8_000);
		const beforeOrphans = countOrphanToolParts(messages);
		const result = clearOldToolResults(messages, {
			keepPairs: 2,
			minClearTokens: 100,
			neverClearTools: new Set(["askUser"]),
			placeholder:
				"[tool result cleared — re-run this tool with the same args if needed]",
		});
		expect(result.changed).toBe(true);
		expect(result.clearedCount).toBe(3);
		expect(countOrphanToolParts(result.messages)).toBe(beforeOrphans);

		// Oldest three cleared
		for (let i = 0; i < 3; i++) {
			const toolMsg = result.messages[2 + i * 2 + 1];
			const part = (
				toolMsg?.content as Array<{ output: { value: string } }>
			)[0];
			expect(part?.output?.value).toContain("[tool result cleared");
		}
		// Newest two intact
		for (let i = 3; i < 5; i++) {
			const toolMsg = result.messages[2 + i * 2 + 1];
			const part = (
				toolMsg?.content as Array<{ output: { value: string } }>
			)[0];
			expect(part?.output?.value).toBe(bigPayload(8_000));
		}
	});

	it("never clears askUser results", () => {
		const messages: CoreMessage[] = [
			{ role: "user", content: "ask me" },
			{
				role: "assistant",
				content: [toolCall("a1", "askUser", { query: "ok?" })],
			},
			{
				role: "tool",
				content: [toolResult("a1", "askUser", bigPayload(20_000))],
			},
			{
				role: "assistant",
				content: [toolCall("e1", "emailGet", { id: "m1" })],
			},
			{
				role: "tool",
				content: [toolResult("e1", "emailGet", bigPayload(20_000))],
			},
		];
		const result = clearOldToolResults(messages, {
			keepPairs: 0,
			minClearTokens: 100,
			neverClearTools: new Set(["askUser"]),
			placeholder: "[tool result cleared]",
		});
		expect(result.clearedCount).toBe(1);
		const askPart = (
			result.messages[2]?.content as Array<{ output: { value: string } }>
		)[0];
		expect(askPart?.output?.value).toBe(bigPayload(20_000));
		const emailPart = (
			result.messages[4]?.content as Array<{ output: { value: string } }>
		)[0];
		expect(emailPart?.output?.value).toContain("[tool result cleared");
	});

	it("skips when reclaim is below minClearTokens", () => {
		const messages = historyWithToolResults(3, 40); // tiny payloads
		const result = clearOldToolResults(messages, {
			keepPairs: 0,
			minClearTokens: 50_000,
			neverClearTools: new Set(),
			placeholder: "[tool result cleared]",
		});
		expect(result.changed).toBe(false);
		expect(result.clearedCount).toBe(0);
	});
});

describe("resultKey", () => {
	it("keys fetchWebContent by normalized URL", () => {
		expect(
			resultKey("fetchWebContent", {
				url: "https://Example.COM/path#frag",
			}),
		).toBe("fetchWebContent:https://example.com/path");
	});

	it("keys readPdf by source kind, value, and page range", () => {
		expect(resultKey("readPdf", { filename: "brief.pdf", startPage: 2 })).toBe(
			"readPdf:attachment:brief.pdf:2:",
		);
		expect(resultKey("readPdf", { path: "attachments/brief.pdf" })).toBe(
			"readPdf:project:attachments/brief.pdf::",
		);
		expect(
			resultKey("readPdf", {
				url: "https://Example.COM/doc.pdf#p=1",
				endPage: 4,
			}),
		).toBe("readPdf:url:https://example.com/doc.pdf::4");
	});

	it("keys email body by mailbox + uid", () => {
		expect(resultKey("getEmailBody", { uid: 42, mailbox: "INBOX" })).toBe(
			"getEmailBody:INBOX:42",
		);
	});

	it("keys jira issues case-insensitively", () => {
		expect(resultKey("getJiraIssue", { issueKey: "proj-1" })).toBe(
			"getJiraIssue:PROJ-1",
		);
	});

	it("returns null for unknown tools without strong args", () => {
		expect(resultKey("completeTask", { taskId: "1" })).toBeNull();
		expect(resultKey("mysteryTool", { foo: "bar" })).toBeNull();
	});

	it("uses generic path fallback", () => {
		expect(resultKey("readSomething", { path: "/tmp/a.md" })).toBe(
			"readSomething:/tmp/a.md",
		);
	});
});

describe("dedupeSupersededToolResults", () => {
	it("blanks earlier results for the same resource, keeps the newest", () => {
		const messages: CoreMessage[] = [
			{ role: "user", content: "read the page twice" },
			{
				role: "assistant",
				content: [
					toolCall("c1", "fetchWebContent", { url: "https://example.com/a" }),
				],
			},
			{
				role: "tool",
				content: [toolResult("c1", "fetchWebContent", bigPayload(20_000))],
			},
			{
				role: "assistant",
				content: [
					toolCall("c2", "fetchWebContent", { url: "https://example.com/a" }),
				],
			},
			{
				role: "tool",
				content: [
					toolResult("c2", "fetchWebContent", `${bigPayload(20_000)}NEW`),
				],
			},
		];
		const result = dedupeSupersededToolResults(messages, {
			minClearTokens: 100,
			neverClearTools: new Set(),
			clearedPlaceholder: "[tool result cleared]",
		});
		expect(result.changed).toBe(true);
		expect(result.dedupedCount).toBe(1);
		const first = (
			result.messages[2]?.content as Array<{ output: { value: string } }>
		)[0];
		const second = (
			result.messages[4]?.content as Array<{ output: { value: string } }>
		)[0];
		expect(first?.output?.value).toContain("[superseded tool result");
		expect(second?.output?.value).toBe(`${bigPayload(20_000)}NEW`);
		expect(countOrphanToolParts(result.messages)).toBe(0);
	});

	it("does not dedupe different resources", () => {
		const messages: CoreMessage[] = [
			{
				role: "assistant",
				content: [
					toolCall("c1", "fetchWebContent", { url: "https://example.com/a" }),
				],
			},
			{
				role: "tool",
				content: [toolResult("c1", "fetchWebContent", bigPayload(20_000))],
			},
			{
				role: "assistant",
				content: [
					toolCall("c2", "fetchWebContent", { url: "https://example.com/b" }),
				],
			},
			{
				role: "tool",
				content: [toolResult("c2", "fetchWebContent", bigPayload(20_000))],
			},
		];
		const result = dedupeSupersededToolResults(messages, {
			minClearTokens: 100,
			neverClearTools: new Set(),
			clearedPlaceholder: "[tool result cleared]",
		});
		expect(result.changed).toBe(false);
		expect(result.dedupedCount).toBe(0);
	});

	it("never dedupes askUser", () => {
		const messages: CoreMessage[] = [
			{
				role: "assistant",
				content: [toolCall("a1", "askUser", { query: "ok?" })],
			},
			{
				role: "tool",
				content: [toolResult("a1", "askUser", bigPayload(20_000))],
			},
			{
				role: "assistant",
				content: [toolCall("a2", "askUser", { query: "ok?" })],
			},
			{
				role: "tool",
				content: [toolResult("a2", "askUser", bigPayload(20_000))],
			},
		];
		const result = dedupeSupersededToolResults(messages, {
			minClearTokens: 100,
			neverClearTools: new Set(["askUser"]),
			clearedPlaceholder: "[tool result cleared]",
		});
		expect(result.changed).toBe(false);
	});
});

describe("applyTieredCompaction", () => {
	it("no-ops when under target", () => {
		const messages: CoreMessage[] = [
			{ role: "system", content: "sys" },
			{ role: "user", content: "hi" },
		];
		const config = resolveCompactionConfig({ contextWindowTokens: 128_000 });
		const result = applyTieredCompaction(messages, config);
		expect(result.changed).toBe(false);
		expect(result.strategiesApplied).toEqual([]);
	});

	it("clears tool results when over budget", () => {
		const messages: CoreMessage[] = [
			{ role: "system", content: "sys" },
			{ role: "user", content: "go" },
		];
		for (let i = 0; i < 8; i++) {
			messages.push({
				role: "assistant",
				content: [toolCall(`id${i}`, "emailGet", { id: String(i) })],
			});
			messages.push({
				role: "tool",
				content: [toolResult(`id${i}`, "emailGet", bigPayload(40_000))],
			});
		}
		// Force a low target so clear runs.
		const config = {
			...resolveCompactionConfig({ contextWindowTokens: 10_000 }),
			targetPromptTokens: 5_000,
			minClearTokens: 100,
			keepPairs: 2,
		};
		const before = estimateMessagesTokens(messages);
		const result = applyTieredCompaction(messages, config);
		expect(before).toBeGreaterThan(config.targetPromptTokens);
		expect(result.changed).toBe(true);
		expect(result.strategiesApplied).toContain("clear_tool_results");
		expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
		expect(countOrphanToolParts(result.messages)).toBe(0);
	});

	it("dedupes before clear when the same resource is re-fetched", () => {
		const messages: CoreMessage[] = [
			{ role: "system", content: "sys" },
			{ role: "user", content: "go" },
		];
		// Three fetches of the same URL — only newest should remain full after dedupe.
		for (let i = 0; i < 3; i++) {
			messages.push({
				role: "assistant",
				content: [
					toolCall(`c${i}`, "fetchWebContent", {
						url: "https://example.com/doc",
					}),
				],
			});
			messages.push({
				role: "tool",
				content: [
					toolResult(
						`c${i}`,
						"fetchWebContent",
						bigPayload(50_000) + String(i),
					),
				],
			});
		}
		const config = {
			...resolveCompactionConfig({ contextWindowTokens: 10_000 }),
			targetPromptTokens: 5_000,
			minClearTokens: 100,
			keepPairs: 6,
		};
		const result = applyTieredCompaction(messages, config);
		expect(result.changed).toBe(true);
		expect(result.strategiesApplied).toContain("dedupe_results");
		expect(result.dedupedToolResults).toBe(2);
		// Newest payload still present
		const lastTool = result.messages[result.messages.length - 1];
		const part = (
			lastTool?.content as Array<{ output: { value: string } }>
		)?.[0];
		expect(part?.output?.value).toContain("2");
		expect(part?.output?.value).not.toContain(
			SUPERSEDED_TOOL_RESULT_PLACEHOLDER.slice(0, 20),
		);
	});
});
