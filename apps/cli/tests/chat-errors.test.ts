import { describe, expect, it } from "bun:test";
import { formatChatModelError } from "@toby/core/ai/chat-errors";
import { APICallError, NoOutputGeneratedError } from "ai";

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

	it("unwraps OpenRouter provider errors from metadata.raw", () => {
		const error = new APICallError({
			message: "Provider returned error",
			url: "https://openrouter.ai/api/v1/chat/completions",
			requestBodyValues: {},
			statusCode: 400,
			responseHeaders: {},
			responseBody: JSON.stringify({
				error: {
					message: "Provider returned error",
					code: 400,
					metadata: {
						provider_name: "Azure",
						raw: JSON.stringify({
							error: {
								message:
									"Response input messages must contain the word 'json' in some form to use 'text.format' of type 'json_object'.",
								type: "invalid_request_error",
							},
						}),
					},
				},
			}),
			isRetryable: false,
		});
		expect(formatChatModelError(error)).toBe(
			"Azure: Response input messages must contain the word 'json' in some form to use 'text.format' of type 'json_object'.",
		);
	});

	it("reads an object-shaped upstream provider error", () => {
		const error = new APICallError({
			message: "Provider returned error",
			url: "https://openrouter.ai/api/v1/chat/completions",
			requestBodyValues: {},
			statusCode: 400,
			responseHeaders: {},
			responseBody: JSON.stringify({
				error: {
					message: "Provider returned error",
					metadata: {
						raw: {
							error: { message: "Model does not support json_schema." },
						},
					},
				},
			}),
			isRetryable: false,
		});
		expect(formatChatModelError(error)).toBe(
			"Model does not support json_schema.",
		);
	});
});
