import { readCredentials } from "../../config/index";
import { resolveVercelGatewayAuthToken as resolveVercelToken } from "../plan-usage/credentials";

/** OpenAI API token from credentials (no env fallback; matches chat). */
export function resolveOpenAiApiToken(): string | undefined {
	const token = readCredentials().ai?.openai?.token?.trim();
	return token && token.length > 0 ? token : undefined;
}

/** Re-export Vercel gateway auth (creds → AI_GATEWAY_API_KEY → OIDC). */
export const resolveVercelGatewayAuthToken = resolveVercelToken;
