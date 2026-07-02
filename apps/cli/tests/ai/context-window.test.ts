import { describe, expect, it } from "bun:test";
import {
	computeContextFillPercentage,
	extractContextInputTokens,
	resolveContextWindowInfo,
} from "@toby/core/ai/context-window";

describe("context window metadata", () => {
	it("computes fill percentage from input tokens and context window", () => {
		expect(computeContextFillPercentage(64_000, 128_000)).toBe(50);
		expect(computeContextFillPercentage(200_000, 128_000)).toBe(100);
		expect(computeContextFillPercentage(undefined, 128_000)).toBeUndefined();
	});

	it("extracts input tokens from SDK and raw provider usage shapes", () => {
		expect(
			extractContextInputTokens({
				inputTokens: 64_000,
				outputTokens: 1,
				totalTokens: 64_001,
			}),
		).toBe(64_000);

		expect(
			extractContextInputTokens({
				outputTokens: 1,
				totalTokens: 64_001,
				raw: { prompt_tokens: 64_000 },
			} as never),
		).toBe(64_000);

		expect(
			extractContextInputTokens({
				outputTokens: 1,
				totalTokens: 64_001,
				raw: { usage: { input_tokens: 64_000 } },
			} as never),
		).toBe(64_000);
	});

	it("falls back to input token detail totals", () => {
		expect(
			extractContextInputTokens({
				outputTokens: 1,
				totalTokens: 101,
				inputTokenDetails: {
					noCacheTokens: 40,
					cacheReadTokens: 50,
					cacheWriteTokens: 10,
				},
			} as never),
		).toBe(100);
	});

	it("derives input tokens from total and output token counts", () => {
		expect(
			extractContextInputTokens({
				outputTokens: 1_000,
				totalTokens: 65_000,
			} as never),
		).toBe(64_000);

		expect(
			extractContextInputTokens({
				raw: {
					usage: {
						total_tokens: 65_000,
						completion_tokens: 1_000,
					},
				},
			} as never),
		).toBe(64_000);
	});

	it("reports unsupported providers without hardcoded model windows", async () => {
		const info = await resolveContextWindowInfo({
			providerId: "openai",
			model: "gpt-4o",
			usage: { inputTokens: 64_000, outputTokens: 1, totalTokens: 64_001 },
		});

		expect(info.supported).toBe(false);
		if (!info.supported) {
			expect(info.unavailableReason).toContain("doesn't support");
		}
	});
});
