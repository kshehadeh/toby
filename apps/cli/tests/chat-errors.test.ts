import { APICallError, NoOutputGeneratedError } from "ai";
import { describe, expect, it } from "vitest";
import { formatChatModelError } from "../src/ai/chat-errors";

describe("formatChatModelError", () => {
	it("unwraps NoOutputGeneratedError using captured stream error", () => {
		const streamError = new APICallError({
			message: "[object Object]",
			url: "https://example.com",
			requestBodyValues: {},
			statusCode: 402,
			responseHeaders: {},
			responseBody: JSON.stringify({
				error: {
					message: "A positive credit balance is required.",
				},
			}),
			isRetryable: false,
		});
		const wrapped = new NoOutputGeneratedError({
			message: "No output generated. Check the stream for errors.",
		});
		expect(formatChatModelError(wrapped, streamError)).toBe(
			"A positive credit balance is required.",
		);
	});

	it("returns a helpful fallback for bare NoOutputGeneratedError", () => {
		const wrapped = new NoOutputGeneratedError();
		expect(formatChatModelError(wrapped)).toContain(
			"The model returned no output",
		);
	});
});
