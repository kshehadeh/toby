import { runAzureAdOAuthPkceFlow } from "./auth";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

const REQUIRED_GRAPH_PERMISSIONS = [
	"User.Read.All",
	"User.ReadBasic.All",
] as const;

export type AzureAdAuthMethod = "oauth_pkce" | "client_credentials";

export type AzureAdConfig = {
	readonly tenantId: string;
	readonly clientId: string;
	readonly clientSecret?: string;
	readonly redirectUri?: string;
	readonly authMethod: AzureAdAuthMethod;
	readonly oauthAccessToken?: string;
	readonly oauthRefreshToken?: string;
	readonly oauthExpiresAt?: string;
};

type CachedToken = {
	readonly accessToken: string;
	readonly expiresAtMs: number;
};

type TokenRefreshPatch = {
	readonly oauthAccessToken: string;
	readonly oauthRefreshToken: string;
	readonly oauthExpiresAt: string;
};

let cachedToken: CachedToken | null = null;
let lastTokenPatch: TokenRefreshPatch | undefined;

export function consumeTokenRefreshPatch(): TokenRefreshPatch | undefined {
	const patch = lastTokenPatch;
	lastTokenPatch = undefined;
	return patch;
}

export function parseAzureAdConfig(raw: Record<string, unknown>): AzureAdConfig {
	const tenantId = String(raw.tenantId ?? "").trim();
	const clientId = String(raw.clientId ?? "").trim();
	const clientSecret = String(raw.clientSecret ?? "").trim() || undefined;
	const redirectUri = String(raw.redirectUri ?? "").trim() || undefined;
	const authMethod = resolveAuthMethod(raw, clientSecret);

	return {
		tenantId,
		clientId,
		clientSecret,
		redirectUri,
		authMethod,
		oauthAccessToken: String(raw.oauthAccessToken ?? "").trim() || undefined,
		oauthRefreshToken: String(raw.oauthRefreshToken ?? "").trim() || undefined,
		oauthExpiresAt: String(raw.oauthExpiresAt ?? "").trim() || undefined,
	};
}

export function resolveAuthMethod(
	raw: Record<string, unknown>,
	clientSecretHint?: string,
): AzureAdAuthMethod {
	const explicit = String(raw.authMethod ?? "").trim();
	if (explicit === "oauth_pkce" || explicit === "client_credentials") {
		return explicit;
	}
	const clientSecret =
		clientSecretHint ?? String(raw.clientSecret ?? "").trim();
	return clientSecret ? "client_credentials" : "oauth_pkce";
}

export function normalizeConfig(
	raw: Record<string, unknown>,
): Record<string, unknown> {
	const parsed = parseAzureAdConfig(raw);
	return {
		tenantId: parsed.tenantId,
		clientId: parsed.clientId,
		clientSecret: parsed.clientSecret ?? "",
		redirectUri: parsed.redirectUri ?? "",
		authMethod: parsed.authMethod,
		oauthAccessToken: parsed.oauthAccessToken ?? "",
		oauthRefreshToken: parsed.oauthRefreshToken ?? "",
		oauthExpiresAt: parsed.oauthExpiresAt ?? "",
	};
}

export function hasAzureAdCredentials(config: Record<string, unknown>): boolean {
	const parsed = parseAzureAdConfig(config);
	if (!parsed.tenantId || !parsed.clientId) return false;
	if (parsed.authMethod === "oauth_pkce") return true;
	return Boolean(parsed.clientSecret);
}

export function getRequiredAzureAdGraphPermissions(): readonly string[] {
	return REQUIRED_GRAPH_PERMISSIONS;
}

function isTokenFresh(token: CachedToken): boolean {
	return token.expiresAtMs - Date.now() > 60_000;
}

function base64UrlDecode(input: string): string {
	const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
	const pad =
		normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
	return Buffer.from(`${normalized}${pad}`, "base64").toString("utf8");
}

export function parseJwtClaims(
	accessToken: string,
): Record<string, unknown> | null {
	const parts = accessToken.split(".");
	if (parts.length < 2) return null;
	const payload = parts[1];
	if (!payload) return null;
	try {
		return JSON.parse(base64UrlDecode(payload)) as Record<string, unknown>;
	} catch {
		return null;
	}
}

export async function getGraphAccessToken(
	creds: AzureAdConfig,
): Promise<{
	readonly accessToken: string;
	readonly expiresAtMs: number;
	readonly claims: Record<string, unknown> | null;
}> {
	if (cachedToken && isTokenFresh(cachedToken)) {
		return {
			...cachedToken,
			claims: parseJwtClaims(cachedToken.accessToken),
		};
	}

	if (creds.authMethod === "oauth_pkce") {
		const token = await getOAuthGraphAccessToken(creds);
		cachedToken = token;
		return {
			...token,
			claims: parseJwtClaims(token.accessToken),
		};
	}

	const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(
		creds.tenantId,
	)}/oauth2/v2.0/token`;
	const clientSecret = creds.clientSecret;
	if (!clientSecret) {
		throw new Error(
			"Azure AD client-credentials auth requires clientSecret. Run `toby configure`.",
		);
	}

	const body = new URLSearchParams({
		client_id: creds.clientId,
		client_secret: clientSecret,
		grant_type: "client_credentials",
		scope: "https://graph.microsoft.com/.default",
	});

	const res = await fetch(tokenUrl, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
	});

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(
			`Azure AD token request failed (${res.status}): ${text || res.statusText}`,
		);
	}

	const json = (await res.json()) as {
		access_token?: unknown;
		expires_in?: unknown;
	};

	if (typeof json.access_token !== "string") {
		throw new Error("Azure AD token response missing access_token");
	}

	const expiresInSec =
		typeof json.expires_in === "number" ? json.expires_in : 3600;
	const token: CachedToken = {
		accessToken: json.access_token,
		expiresAtMs: Date.now() + Math.max(60, expiresInSec) * 1000,
	};
	cachedToken = token;

	return {
		...token,
		claims: parseJwtClaims(token.accessToken),
	};
}

async function getOAuthGraphAccessToken(
	creds: AzureAdConfig,
): Promise<CachedToken> {
	const expiresAtMs = parseOAuthExpiry(creds.oauthExpiresAt);
	if (
		creds.oauthAccessToken &&
		typeof expiresAtMs === "number" &&
		expiresAtMs - Date.now() > 60_000
	) {
		return { accessToken: creds.oauthAccessToken, expiresAtMs };
	}

	if (!creds.oauthRefreshToken) {
		throw new Error(
			"Azure AD OAuth token is missing a refresh token. Run `toby connect azuread` again.",
		);
	}

	const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(
		creds.tenantId,
	)}/oauth2/v2.0/token`;
	const body = new URLSearchParams({
		client_id: creds.clientId,
		grant_type: "refresh_token",
		refresh_token: creds.oauthRefreshToken,
		scope:
			"offline_access openid profile User.Read.All User.ReadBasic.All https://graph.microsoft.com/.default",
	});

	const res = await fetch(tokenUrl, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(
			`Azure AD OAuth refresh failed (${res.status}): ${text || res.statusText}`,
		);
	}
	const json = (await res.json()) as {
		access_token?: unknown;
		refresh_token?: unknown;
		expires_in?: unknown;
	};
	if (typeof json.access_token !== "string") {
		throw new Error("Azure AD OAuth refresh response missing access_token");
	}

	const nextRefreshToken =
		typeof json.refresh_token === "string"
			? json.refresh_token
			: creds.oauthRefreshToken;
	const nextExpiresAtMs =
		Date.now() +
		Math.max(60, normalizeExpiresInSeconds(json.expires_in)) * 1000;

	lastTokenPatch = {
		oauthAccessToken: json.access_token,
		oauthRefreshToken: nextRefreshToken,
		oauthExpiresAt: new Date(nextExpiresAtMs).toISOString(),
	};

	return { accessToken: json.access_token, expiresAtMs: nextExpiresAtMs };
}

function normalizeExpiresInSeconds(expiresIn: unknown): number {
	return typeof expiresIn === "number" ? expiresIn : 3600;
}

function parseOAuthExpiry(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

async function graphFetch<T>(
	creds: AzureAdConfig,
	path: string,
): Promise<T> {
	const { accessToken } = await getGraphAccessToken(creds);
	const res = await fetch(`${GRAPH_BASE_URL}${path}`, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: "application/json",
		},
	});

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(
			`Graph request failed (${res.status}) ${path}: ${text || res.statusText}`,
		);
	}

	return (await res.json()) as T;
}

type GraphUserBasic = {
	readonly id: string;
	readonly displayName?: string;
	readonly userPrincipalName?: string;
	readonly mail?: string;
	readonly jobTitle?: string;
	readonly department?: string;
};

export async function getUserManager(
	creds: AzureAdConfig,
	idOrUpn: string,
): Promise<GraphUserBasic | null> {
	const key = idOrUpn.trim();
	if (!key) {
		throw new Error("Missing user id or UPN");
	}
	try {
		const manager = await graphFetch<unknown>(
			creds,
			`/users/${encodeURIComponent(
				key,
			)}/manager?$select=id,displayName,userPrincipalName,mail,jobTitle,department`,
		);
		return isGraphUserBasic(manager) ? manager : null;
	} catch (error) {
		if (error instanceof Error && /\(404\)/.test(error.message)) {
			return null;
		}
		throw error;
	}
}

export async function getUserDirectReports(
	creds: AzureAdConfig,
	idOrUpn: string,
	limit = 25,
): Promise<GraphUserBasic[]> {
	const key = idOrUpn.trim();
	if (!key) {
		throw new Error("Missing user id or UPN");
	}
	const top = Math.min(Math.max(1, limit), 999);
	const res = await graphFetch<{ value?: unknown[] }>(
		creds,
		`/users/${encodeURIComponent(
			key,
		)}/directReports?$top=${top}&$select=id,displayName,userPrincipalName,mail,jobTitle,department`,
	);
	const rows = Array.isArray(res.value) ? res.value : [];
	return rows.filter(isGraphUserBasic);
}

export async function testAzureAdConnection(creds: AzureAdConfig): Promise<void> {
	await graphFetch<{ value?: unknown }>(
		creds,
		"/users?$top=1&$select=id",
	);
}

export async function fetchUsersTop(
	creds: AzureAdConfig,
	limit = 10,
): Promise<GraphUserBasic[]> {
	const top = Math.min(Math.max(1, limit), 50);
	const res = await graphFetch<{ value?: unknown[] }>(
		creds,
		`/users?$top=${top}&$select=id,displayName,userPrincipalName,mail,jobTitle,department`,
	);
	const rows = Array.isArray(res.value) ? res.value : [];
	return rows.filter(isGraphUserBasic);
}

export async function searchUsers(
	creds: AzureAdConfig,
	query: string,
	limit = 10,
): Promise<GraphUserBasic[]> {
	const q = query.trim();
	if (!q) return [];
	const top = Math.min(Math.max(1, limit), 50);
	const filter = encodeURIComponent(
		`startsWith(displayName,'${q.replace(/'/g, "''")}') or startsWith(userPrincipalName,'${q.replace(
			/'/g,
			"''",
		)}')`,
	);
	const res = await graphFetch<{ value?: unknown[] }>(
		creds,
		`/users?$top=${top}&$select=id,displayName,userPrincipalName,mail,jobTitle,department&$filter=${filter}`,
	);
	const rows = Array.isArray(res.value) ? res.value : [];
	return rows.filter(isGraphUserBasic);
}

export async function getUserByIdOrUpn(
	creds: AzureAdConfig,
	idOrUpn: string,
): Promise<GraphUserBasic> {
	const key = idOrUpn.trim();
	if (!key) {
		throw new Error("Missing user id or UPN");
	}
	return await graphFetch<GraphUserBasic>(
		creds,
		`/users/${encodeURIComponent(
			key,
		)}?$select=id,displayName,userPrincipalName,mail,jobTitle,department`,
	);
}

export function getTokenPermissionDiagnostics(
	claims: Record<string, unknown> | null,
): {
	readonly present: readonly string[];
	readonly missing: readonly string[];
	readonly mode: "delegated" | "app" | "unknown";
} {
	const scp = typeof claims?.scp === "string" ? claims.scp : undefined;
	const rolesRaw = claims?.roles;
	const roles = Array.isArray(rolesRaw)
		? rolesRaw.filter((r): r is string => typeof r === "string")
		: undefined;

	const mode: "delegated" | "app" | "unknown" = scp?.trim()
		? "delegated"
		: roles && roles.length > 0
			? "app"
			: "unknown";

	const granted = new Set<string>();
	for (const p of scp?.split(/\s+/).filter(Boolean) ?? []) granted.add(p);
	for (const r of roles ?? []) granted.add(r);

	const present = REQUIRED_GRAPH_PERMISSIONS.filter((p) => granted.has(p));
	const missing = REQUIRED_GRAPH_PERMISSIONS.filter((p) => !granted.has(p));

	return { present, missing, mode };
}

export async function validateAzureAdConnectivity(
	config: Record<string, unknown>,
): Promise<void> {
	const creds = parseAzureAdConfig(config);
	const { accessToken, claims } = await getGraphAccessToken(creds);
	if (!accessToken) {
		throw new Error("Could not obtain Graph access token.");
	}
	const diag = getTokenPermissionDiagnostics(claims);
	if (diag.missing.length > 0) {
		const modeHelp =
			diag.mode === "delegated"
				? "Ensure delegated Microsoft Graph permissions are granted and consented."
				: "Ensure your app has admin-consented Microsoft Graph application permissions.";
		throw new Error(
			`Token missing permissions: ${diag.missing.join(
				", ",
			)}. ${modeHelp} Required: ${getRequiredAzureAdGraphPermissions().join(
				", ",
			)}.`,
		);
	}

	await testAzureAdConnection(creds);
}

export async function runOAuthConnect(
	config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const creds = parseAzureAdConfig(config);
	const tokens = await runAzureAdOAuthPkceFlow({
		tenantId: creds.tenantId,
		clientId: creds.clientId,
		redirectUri: creds.redirectUri,
	});
	return {
		authMethod: "oauth_pkce",
		oauthAccessToken: tokens.accessToken,
		oauthRefreshToken: tokens.refreshToken,
		oauthExpiresAt: new Date(tokens.expiresAtMs).toISOString(),
	};
}

function isGraphUserBasic(value: unknown): value is GraphUserBasic {
	if (!value || typeof value !== "object") return false;
	const v = value as { id?: unknown };
	return typeof v.id === "string";
}
