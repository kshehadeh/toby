import { readCredentials } from "../../config/index";

/** Auth token for Vercel AI Gateway billing APIs (same sources as chat). */
export function resolveVercelGatewayAuthToken(): string | undefined {
	// readCredentials can throw when credentials.json is encrypted but the
	// key backend is unavailable (e.g. test environments). Fall through to
	// env vars in that case.
	let creds: ReturnType<typeof readCredentials>;
	try {
		creds = readCredentials();
	} catch {
		creds = {};
	}
	const fromCreds = creds.ai?.vercel?.apiKey?.trim();
	if (fromCreds) {
		return fromCreds;
	}
	const fromEnv = process.env.AI_GATEWAY_API_KEY?.trim();
	if (fromEnv && fromEnv.length > 0) {
		return fromEnv;
	}
	const oidc = process.env.VERCEL_OIDC_TOKEN?.trim();
	return oidc && oidc.length > 0 ? oidc : undefined;
}
