import { tool } from "ai";
import { z } from "zod";
import {
	fetchUsersTop,
	getUserByIdOrUpn,
	getUserDirectReports,
	getUserManager,
	searchUsers,
} from "./client";

interface AzureAdToolContext {
	readonly dryRun: boolean;
	readonly appliedActions: string[];
}

export function createAzureAdTools(_ctx: AzureAdToolContext) {
	return {
		listUsers: tool({
			description:
				"List a small sample of users from Azure AD (Microsoft Graph). Use this to get IDs/UPNs for later lookups.",
			inputSchema: z.object({
				limit: z.number().int().min(1).max(50).optional(),
			}),
			execute: async ({ limit }) => {
				const users = await fetchUsersTop(limit ?? 10);
				return { users };
			},
		}),

		searchUsers: tool({
			description:
				"Search users by display name or UPN prefix in Azure AD (Microsoft Graph). Returns basic profile fields.",
			inputSchema: z.object({
				query: z.string().min(1).describe("Name or UPN prefix to search for"),
				limit: z.number().int().min(1).max(50).optional(),
			}),
			execute: async ({ query, limit }) => {
				const users = await searchUsers(query, limit ?? 10);
				return { users };
			},
		}),

		getUser: tool({
			description:
				"Fetch a user by Azure AD object id or userPrincipalName (UPN).",
			inputSchema: z.object({
				idOrUpn: z
					.string()
					.min(1)
					.describe("User id (GUID) or UPN (e.g. alice@contoso.com)"),
			}),
			execute: async ({ idOrUpn }) => {
				const user = await getUserByIdOrUpn(idOrUpn);
				return { user };
			},
		}),

		getUserManager: tool({
			description:
				"Get the manager for a user (who they report to). Returns null if no manager is set.",
			inputSchema: z.object({
				idOrUpn: z
					.string()
					.min(1)
					.describe("User id (GUID) or UPN (e.g. alice@contoso.com)"),
			}),
			execute: async ({ idOrUpn }) => {
				const manager = await getUserManager(idOrUpn);
				return { manager };
			},
		}),

		getUserDirectReports: tool({
			description: "Get the direct reports for a user (who reports to them).",
			inputSchema: z.object({
				idOrUpn: z
					.string()
					.min(1)
					.describe("User id (GUID) or UPN (e.g. alice@contoso.com)"),
				limit: z.number().int().min(1).max(999).optional(),
			}),
			execute: async ({ idOrUpn, limit }) => {
				const reports = await getUserDirectReports(idOrUpn, limit ?? 25);
				return { reports };
			},
		}),
	};
}
