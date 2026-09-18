import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	clearSessionToolBundleCache,
	loadIntegrationToolBundle,
} from "@toby/core/chat-pipeline/tool-bundle-cache";
import {
	clearCredentialsCache,
	readConfig,
	readCredentials,
} from "@toby/core/config/index";
import { mcpPrefixedToolName } from "@toby/core/integrations/connections";
import { getIntegrationModule } from "@toby/core/integrations/index";
import {
	closeAllMcpSessions,
	connectMcpSession,
	disconnectMcpSession,
	getMcpSession,
	listMcpSessionTools,
	setMcpClientFactory,
} from "@toby/core/integrations/mcp/index";
import { handleWebRequest } from "@toby/core/web/routes";
import type { Tool } from "ai";

let tempDir: string;
let previousTobyDir: string | undefined;

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-mcp-test-"));
	previousTobyDir = process.env.TOBY_DIR;
	process.env.TOBY_DIR = tempDir;
	clearCredentialsCache();
	setMcpClientFactory(async (record) => {
		const search: Tool = {
			description: "Search things",
			inputSchema: undefined as never,
			execute: async () => ({ ok: true, connection: record.id }),
		} as Tool;
		return {
			connectionId: record.id,
			tools: { search, "get-issue": search },
			originalNames: { search: "search", "get-issue": "get-issue" },
			close: async () => {},
		};
	});
});

afterEach(async () => {
	await closeAllMcpSessions();
	setMcpClientFactory(null);
	clearSessionToolBundleCache();
	clearCredentialsCache();
	if (previousTobyDir === undefined) {
		Reflect.deleteProperty(process.env, "TOBY_DIR");
	} else {
		process.env.TOBY_DIR = previousTobyDir;
	}
	fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("MCP connections", () => {
	it("creates, connects, prefixes tools, and stores secrets only under connections", async () => {
		const created = await handleWebRequest(
			new Request("http://127.0.0.1/api/connections", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					type: "mcp",
					displayName: "GitHub",
					transport: "http",
					url: "https://api.githubcopilot.com/mcp/",
					authMethod: "headers",
					bearerToken: "secret-token",
				}),
			}),
		);
		expect(created.status).toBe(201);
		const body = (await created.json()) as {
			connection: { id: string; connected: boolean };
		};
		expect(body.connection.id).toBe("mcp_github");
		expect(body.connection.connected).toBe(true);
		expect(getMcpSession("mcp_github")).toBeDefined();

		const tools = listMcpSessionTools("mcp_github");
		expect(tools.map((t) => t.name).sort()).toEqual([
			"mcp_github_get_issue",
			"mcp_github_search",
		]);
		expect(mcpPrefixedToolName("mcp_github", "search")).toBe(
			"mcp_github_search",
		);

		const creds = readCredentials();
		expect(creds.connections?.mcp_github?.bearerToken).toBe("secret-token");
		expect(creds.integrations?.mcp_github).toBeUndefined();
		expect(readConfig().integrations.mcp_github).toBeUndefined();

		const listed = await handleWebRequest(
			new Request("http://127.0.0.1/api/connections"),
		);
		const listBody = (await listed.json()) as {
			connections: Array<{ id: string }>;
		};
		expect(listBody.connections.some((c) => c.id === "mcp_github")).toBe(true);

		await disconnectMcpSession("mcp_github");
		expect(getMcpSession("mcp_github")).toBeUndefined();
		expect(readConfig().connections?.mcp_github?.connectedAt).toBeUndefined();
		expect(readConfig().connections?.mcp_github?.url).toBe(
			"https://api.githubcopilot.com/mcp/",
		);
	});

	it("rejects a second HTTP server without a URL", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/connections", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					type: "mcp",
					displayName: "Broken",
					transport: "http",
					connect: false,
				}),
			}),
		);
		expect(res.status).toBe(400);
	});

	it("refuses OAuth on stdio transports", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/connections", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					type: "mcp",
					displayName: "Local",
					transport: "stdio",
					command: "npx",
					authMethod: "oauth",
					connect: false,
				}),
			}),
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/cannot use OAuth/i);
	});

	it("filters tools through an allowlist", async () => {
		await handleWebRequest(
			new Request("http://127.0.0.1/api/connections", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					type: "mcp",
					displayName: "Linear",
					transport: "sse",
					url: "https://mcp.linear.app/sse",
					toolAllowlist: ["search"],
				}),
			}),
		);
		const tools = listMcpSessionTools("mcp_linear");
		expect(tools.map((t) => t.name)).toEqual(["mcp_linear_search"]);
	});

	it("DELETE removes a connection that never connected", async () => {
		const created = await handleWebRequest(
			new Request("http://127.0.0.1/api/connections", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					type: "mcp",
					displayName: "Orphan",
					transport: "http",
					url: "https://example.com/mcp",
					connect: false,
				}),
			}),
		);
		expect(created.status).toBe(201);
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/connections/mcp_orphan", {
				method: "DELETE",
			}),
		);
		expect(res.status).toBe(200);
		expect(readConfig().connections?.mcp_orphan).toBeUndefined();
	});

	it("keeps a failed MCP record so it can be removed", async () => {
		setMcpClientFactory(async () => {
			throw new Error("Could not reach MCP server");
		});
		const created = await handleWebRequest(
			new Request("http://127.0.0.1/api/connections", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					type: "mcp",
					displayName: "Jira",
					transport: "http",
					url: "https://mcp.atlassian.com/v2/mcp",
					authMethod: "oauth",
				}),
			}),
		);
		expect(created.status).toBe(500);
		expect(readConfig().connections?.mcp_jira?.url).toBe(
			"https://mcp.atlassian.com/v2/mcp",
		);
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/connections/mcp_jira", {
				method: "DELETE",
			}),
		);
		expect(res.status).toBe(200);
		expect(readConfig().connections?.mcp_jira).toBeUndefined();
	});

	it("does not start an MCP session from status checks", async () => {
		await handleWebRequest(
			new Request("http://127.0.0.1/api/connections", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					type: "mcp",
					displayName: "Idle",
					transport: "http",
					url: "https://example.com/mcp",
					authMethod: "oauth",
					connect: false,
				}),
			}),
		);
		let started = false;
		setMcpClientFactory(async () => {
			started = true;
			throw new Error("should not connect");
		});
		const mod = getIntegrationModule("mcp_idle");
		expect(mod).toBeDefined();
		const health = await mod?.testConnection({ validateTools: true });
		expect(started).toBe(false);
		expect(health?.ok).toBe(false);
		expect(getMcpSession("mcp_idle")).toBeUndefined();
	});

	it("two MCP servers can expose the same original tool name", async () => {
		await connectViaApi("Alpha", "https://a.example/mcp");
		await connectViaApi("Beta", "https://b.example/mcp");
		const names = [
			...listMcpSessionTools("mcp_alpha"),
			...listMcpSessionTools("mcp_beta"),
		].map((t) => t.name);
		expect(names).toContain("mcp_alpha_search");
		expect(names).toContain("mcp_beta_search");
	});

	it("registers a virtual chat module and prefixes tools in the chat bundle", async () => {
		await connectViaApi("GitHub", "https://api.githubcopilot.com/mcp/");
		const mod = getIntegrationModule("mcp_github");
		expect(mod?.capabilities).toContain("chat");
		expect(mod?.displayName).toBe("GitHub");
		if (!mod) throw new Error("expected MCP chat module");
		const bundle = await loadIntegrationToolBundle([mod], { dryRun: false });
		expect(Object.keys(bundle.tools).sort()).toEqual([
			"mcp_github_get_issue",
			"mcp_github_search",
		]);
		expect(bundle.toolIntegrationLabels.mcp_github_search).toBe("GitHub");
	});

	it("POST disconnect keeps the MCP record", async () => {
		await connectViaApi("Keep", "https://keep.example/mcp");
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/connections/mcp_keep/disconnect", {
				method: "POST",
			}),
		);
		expect(res.status).toBe(200);
		expect(getMcpSession("mcp_keep")).toBeUndefined();
		expect(readConfig().connections?.mcp_keep?.url).toBe(
			"https://keep.example/mcp",
		);
		expect(readConfig().connections?.mcp_keep?.connectedAt).toBeUndefined();
	});

	it("legacy /api/integrations/:name/status aliases MCP connection ids", async () => {
		await handleWebRequest(
			new Request("http://127.0.0.1/api/connections", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					type: "mcp",
					displayName: "Alias",
					transport: "http",
					url: "https://example.com/mcp",
				}),
			}),
		);
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/integrations/mcp_alias/status"),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { name: string; connected: boolean };
		expect(body.name).toBe("mcp_alias");
		expect(body.connected).toBe(true);
	});
});

async function connectViaApi(name: string, url: string): Promise<void> {
	const res = await handleWebRequest(
		new Request("http://127.0.0.1/api/connections", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				type: "mcp",
				displayName: name,
				transport: "http",
				url,
			}),
		}),
	);
	expect(res.status).toBe(201);
}

void connectMcpSession;
