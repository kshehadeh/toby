import { createGateway } from "@ai-sdk/gateway";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

type ProbeResult =
	| { ok: true; text: string }
	| { ok: false; error: string; status: number };

/** Uses only the submitted key; never saves credentials or sends personal context. */
export async function testProviderConnection(
	provider: "vercel" | "openrouter",
	apiKey: string,
	modelId: string,
	run = generateText,
	signal?: AbortSignal,
): Promise<ProbeResult> {
	try {
		const model =
			provider === "vercel"
				? createGateway({ apiKey })(modelId)
				: createOpenAICompatible({
						name: "openrouter",
						baseURL: "https://openrouter.ai/api/v1",
						apiKey,
					})(modelId);
		const result = await run({
			model,
			prompt: 'Reply with only: "Toby is ready to help."',
			maxOutputTokens: 1024,
			maxRetries: 0,
			abortSignal: signal
				? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
				: AbortSignal.timeout(20_000),
		});
		if (!result.text.trim())
			return {
				ok: false,
				status: 400,
				error:
					"The model returned no answer. Try again or choose another provider. Your connection has not been saved.",
			};
		return { ok: true, text: result.text.trim() };
	} catch (error) {
		const status =
			typeof error === "object" && error !== null && "statusCode" in error
				? error.statusCode
				: undefined;
		const message =
			status === 402
				? "Your account needs credits. Open your provider’s billing page, then try again."
				: status === 401 || status === 403
					? "The model could not use this key. Check its permissions or paste another key."
					: status === 429
						? "Your provider is limiting requests. Check your account limits and try again shortly."
						: "The model could not answer. Check your connection and model access, then try again.";
		return {
			ok: false,
			status: 400,
			error: `${message} Your connection has not been saved.`,
		};
	}
}
