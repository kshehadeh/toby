import { getAzureAdCredentials } from "../../config/index";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

const REQUIRED_GRAPH_PERMISSIONS = [
	"User.Read.All",
	"User.ReadBasic.All",
] as const;

type CachedToken = {
	readonly accessToken: string;
	readonly expiresAtMs: number;
};

let cachedToken: CachedToken | null = null;

function isTokenFresh(token: CachedToken): boolean {
	return token.expiresAtMs - Date.now() > 60_000;
}

function base64UrlDecode(input: string): string {
	const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
	const pad =
		normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
	return Buffer.from(`${normalized}${pad}`, "base64").toString("utf8");
}

function parseJwtClaims(accessToken: string): Record<string, unknown> | null {
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

export function getRequiredAzureAdGraphPermissions(): readonly string[] {
	return REQUIRED_GRAPH_PERMISSIONS;
}

export async function getGraphAccessToken(): Promise<{
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

	const creds = getAzureAdCredentials();
	const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(
		creds.tenantId,
	)}/oauth2/v2.0/token`;

	const body = new URLSearchParams({
		client_id: creds.clientId,
		client_secret: creds.clientSecret,
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

async function graphFetch<T>(
	path: string,
	options?: { readonly signal?: AbortSignal },
): Promise<T> {
	const { accessToken } = await getGraphAccessToken();
	const res = await fetch(`${GRAPH_BASE_URL}${path}`, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: "application/json",
		},
		signal: options?.signal,
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
	idOrUpn: string,
): Promise<GraphUserBasic | null> {
	const key = idOrUpn.trim();
	if (!key) {
		throw new Error("Missing user id or UPN");
	}
	try {
		const manager = await graphFetch<unknown>(
			`/users/${encodeURIComponent(
				key,
			)}/manager?$select=id,displayName,userPrincipalName,mail,jobTitle,department`,
		);
		return isGraphUserBasic(manager) ? manager : null;
	} catch (error) {
		// Graph returns 404 when a user has no manager set.
		if (error instanceof Error && /\(404\)/.test(error.message)) {
			return null;
		}
		throw error;
	}
}

export async function getUserDirectReports(
	idOrUpn: string,
	limit = 25,
): Promise<GraphUserBasic[]> {
	const key = idOrUpn.trim();
	if (!key) {
		throw new Error("Missing user id or UPN");
	}
	const top = Math.min(Math.max(1, limit), 999);
	const res = await graphFetch<{ value?: unknown[] }>(
		`/users/${encodeURIComponent(
			key,
		)}/directReports?$top=${top}&$select=id,displayName,userPrincipalName,mail,jobTitle,department`,
	);
	const rows = Array.isArray(res.value) ? res.value : [];
	return rows.filter(isGraphUserBasic);
}

export async function testAzureAdConnection(): Promise<void> {
	await graphFetch<{ value?: unknown }>("/users?$top=1&$select=id");
}

export async function fetchUsersTop(limit = 10): Promise<GraphUserBasic[]> {
	const top = Math.min(Math.max(1, limit), 50);
	const res = await graphFetch<{ value?: unknown[] }>(
		`/users?$top=${top}&$select=id,displayName,userPrincipalName,mail,jobTitle,department`,
	);
	const rows = Array.isArray(res.value) ? res.value : [];
	return rows.filter(isGraphUserBasic);
}

export async function searchUsers(
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
		`/users?$top=${top}&$select=id,displayName,userPrincipalName,mail,jobTitle,department&$filter=${filter}`,
	);
	const rows = Array.isArray(res.value) ? res.value : [];
	return rows.filter(isGraphUserBasic);
}

export async function getUserByIdOrUpn(
	idOrUpn: string,
): Promise<GraphUserBasic> {
	const key = idOrUpn.trim();
	if (!key) {
		throw new Error("Missing user id or UPN");
	}
	return await graphFetch<GraphUserBasic>(
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
	readonly raw?: { readonly scp?: string; readonly roles?: string[] };
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

	return {
		present,
		missing,
		mode,
		raw: scp || roles ? { scp, roles } : undefined,
	};
}

function isGraphUserBasic(value: unknown): value is GraphUserBasic {
	if (!value || typeof value !== "object") return false;
	const v = value as { id?: unknown };
	return typeof v.id === "string";
}
