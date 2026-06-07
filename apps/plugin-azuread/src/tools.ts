import {
	consumeTokenRefreshPatch,
	fetchUsersTop,
	getUserByIdOrUpn,
	getUserDirectReports,
	getUserManager,
	parseAzureAdConfig,
	searchUsers,
} from "./client";

type JsonRecord = Record<string, unknown>;

export const TOOL_DEFINITIONS = [
	{
		name: "listUsers",
		description:
			"List a small sample of users from Azure AD (Microsoft Graph). Use this to get IDs/UPNs for later lookups.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				limit: {
					type: "number",
					description: "Maximum users to return (1-50)",
				},
			},
		},
	},
	{
		name: "searchUsers",
		description:
			"Search users by display name or UPN prefix in Azure AD (Microsoft Graph). Returns basic profile fields.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Name or UPN prefix to search for",
				},
				limit: {
					type: "number",
					description: "Maximum users to return (1-50)",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "getUser",
		description:
			"Fetch a user by Azure AD object id or userPrincipalName (UPN).",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				idOrUpn: {
					type: "string",
					description: "User id (GUID) or UPN (e.g. alice@contoso.com)",
				},
			},
			required: ["idOrUpn"],
		},
	},
	{
		name: "getUserManager",
		description:
			"Get the manager for a user (who they report to). Returns null if no manager is set.",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				idOrUpn: {
					type: "string",
					description: "User id (GUID) or UPN (e.g. alice@contoso.com)",
				},
			},
			required: ["idOrUpn"],
		},
	},
	{
		name: "getUserDirectReports",
		description: "Get the direct reports for a user (who reports to them).",
		readOnly: true,
		inputSchema: {
			type: "object",
			properties: {
				idOrUpn: {
					type: "string",
					description: "User id (GUID) or UPN (e.g. alice@contoso.com)",
				},
				limit: {
					type: "number",
					description: "Maximum reports to return (1-999)",
				},
			},
			required: ["idOrUpn"],
		},
	},
] as const;

export async function executeTool(
	tool: string,
	input: JsonRecord,
	config: JsonRecord,
): Promise<{ result: unknown; config?: Record<string, unknown> }> {
	const creds = parseAzureAdConfig(config);

	switch (tool) {
		case "listUsers": {
			const limit =
				typeof input.limit === "number" ? input.limit : undefined;
			const users = await fetchUsersTop(creds, limit ?? 10);
			return withTokenPatch({ users });
		}
		case "searchUsers": {
			const query = String(input.query ?? "").trim();
			if (!query) throw new Error("query is required");
			const limit =
				typeof input.limit === "number" ? input.limit : undefined;
			const users = await searchUsers(creds, query, limit ?? 10);
			return withTokenPatch({ users });
		}
		case "getUser": {
			const idOrUpn = String(input.idOrUpn ?? "").trim();
			if (!idOrUpn) throw new Error("idOrUpn is required");
			const user = await getUserByIdOrUpn(creds, idOrUpn);
			return withTokenPatch({ user });
		}
		case "getUserManager": {
			const idOrUpn = String(input.idOrUpn ?? "").trim();
			if (!idOrUpn) throw new Error("idOrUpn is required");
			const manager = await getUserManager(creds, idOrUpn);
			return withTokenPatch({ manager });
		}
		case "getUserDirectReports": {
			const idOrUpn = String(input.idOrUpn ?? "").trim();
			if (!idOrUpn) throw new Error("idOrUpn is required");
			const limit =
				typeof input.limit === "number" ? input.limit : undefined;
			const reports = await getUserDirectReports(creds, idOrUpn, limit ?? 25);
			return withTokenPatch({ reports });
		}
		default:
			throw new Error(`Unknown tool: ${tool}`);
	}
}

function withTokenPatch(result: unknown): {
	result: unknown;
	config?: Record<string, unknown>;
} {
	const patch = consumeTokenRefreshPatch();
	return patch ? { result, config: patch } : { result };
}
