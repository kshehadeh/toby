import { describe, expect, it } from "bun:test";
import {
	GATEWAY_FUNDS_EXHAUSTED_CODE,
	GatewayFundsError,
	gatewayFundsErrorBody,
	resolveToolFundsError,
} from "@toby/core/ai/gateway-funds";
import { APICallError } from "ai";

function gatewayError(options: {
	statusCode?: number;
	url?: string;
	message?: string;
	body?: string;
}): APICallError {
	return new APICallError({
		message: options.message ?? "provider error",
		url: options.url ?? "https://ai-gateway.vercel.sh/v1/chat/completions",
		requestBodyValues: {},
		statusCode: options.statusCode,
		responseHeaders: {},
		responseBody: options.body,
		isRetryable: false,
	});
}

describe("gatewayFundsErrorBody", () => {
	it("recognizes an HTTP 402 from Vercel AI Gateway", () => {
		const body = gatewayFundsErrorBody(
			gatewayError({ statusCode: 402, message: "Payment Required" }),
			"send your message",
		);
		expect(body).toEqual({
			error: "Vercel AI Gateway is out of funds.",
			code: GATEWAY_FUNDS_EXHAUSTED_CODE,
			providerId: "vercel",
			activity: "send your message",
		});
	});

	it("recognizes a credit-balance response body", () => {
		const body = gatewayFundsErrorBody(
			gatewayError({
				statusCode: 402,
				url: "https://openrouter.ai/api/v1/chat/completions",
				body: JSON.stringify({
					error: { message: "A positive credit balance is required." },
				}),
			}),
			"update the dashboard",
		);
		expect(body?.providerId).toBe("openrouter");
		expect(body?.error).toBe("OpenRouter is out of funds.");
		expect(body?.activity).toBe("update the dashboard");
	});

	it("ignores a 402 from a direct provider", () => {
		const body = gatewayFundsErrorBody(
			gatewayError({
				statusCode: 402,
				url: "https://api.openai.com/v1/chat/completions",
				message: "insufficient_quota",
			}),
			"send your message",
			"openai",
		);
		expect(body).toBeNull();
	});

	it("identifies the gateway from the request URL when no provider hint is passed", () => {
		const wrapped = new Error("The model returned no output.");
		wrapped.cause = gatewayError({
			statusCode: 200,
			url: "https://ai-gateway.vercel.sh/v1/responses",
			body: JSON.stringify({
				error: { message: "Insufficient credits" },
			}),
		});
		const body = gatewayFundsErrorBody(wrapped, "search the web");
		expect(body?.providerId).toBe("vercel");
		expect(body?.activity).toBe("search the web");
	});

	it("keeps the activity already attached to a GatewayFundsError", () => {
		const error = new GatewayFundsError("vercel", "run a flow");
		const body = gatewayFundsErrorBody(
			error,
			"send your message",
			"openrouter",
		);
		expect(body?.activity).toBe("run a flow");
		expect(body?.providerId).toBe("vercel");
	});
});

describe("resolveToolFundsError", () => {
	it("reads a structured funds payload returned by a tool", () => {
		const payload = new GatewayFundsError("vercel", "search the web").toBody();
		expect(resolveToolFundsError(payload, "webSearch", "vercel")).toEqual(
			payload,
		);
	});

	it("classifies a tool error string when the persona uses a gateway", () => {
		const body = resolveToolFundsError(
			{ error: "A positive credit balance is required." },
			"webSearch",
			"vercel",
		);
		expect(body?.activity).toBe("search the web");
		expect(body?.providerId).toBe("vercel");
	});

	it("leaves ordinary tool errors alone", () => {
		expect(
			resolveToolFundsError(
				{ error: "No search results returned" },
				"webSearch",
				"vercel",
			),
		).toBeNull();
	});
});
