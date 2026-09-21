import { describe, expect, it } from "bun:test";
import { testProviderConnection } from "@toby/core/ai/provider-setup/test-connection";
import type { generateText } from "ai";

function runner(text: string): typeof generateText {
	return (async () => ({ text })) as typeof generateText;
}

describe("guided setup model probe", () => {
	it("accepts a nonempty model response", async () => {
		expect(
			await testProviderConnection(
				"vercel",
				"unused",
				"openai/gpt-5-mini",
				runner(" Ready "),
			),
		).toEqual({ ok: true, text: "Ready" });
	});
	it("rejects empty output even when authentication succeeded", async () => {
		const result = await testProviderConnection(
			"openrouter",
			"unused",
			"test/model",
			runner(" "),
		);
		expect(result.ok).toBe(false);
	});
	it("provides billing recovery without exposing provider errors or secrets", async () => {
		const run = (async () => {
			throw { statusCode: 402, message: "secret-key" };
		}) as typeof generateText;
		const result = await testProviderConnection(
			"openrouter",
			"unused",
			"test/model",
			run,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("credits");
			expect(result.error).not.toContain("secret-key");
		}
	});
	it("limits the probe and excludes personal context", async () => {
		let args: Record<string, unknown> = {};
		const run = (async (options: Record<string, unknown>) => {
			args = options;
			return { text: "Ready" };
		}) as typeof generateText;
		await testProviderConnection("vercel", "unused", "test/model", run);
		expect(args.maxRetries).toBe(0);
		expect(args.abortSignal).toBeInstanceOf(AbortSignal);
		expect(args.messages).toBeUndefined();
		expect(args.tools).toBeUndefined();
		expect(args.prompt).toBe('Reply with only: "Toby is ready to help."');
	});
});
