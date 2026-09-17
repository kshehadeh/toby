import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	clearCredentialsCache,
	getConfigPath,
	readConfig,
	readCredentials,
	writeConfig,
	writeCredentials,
} from "@toby/core/config/index";
import {
	allocateMcpConnectionId,
	deleteConnection,
	getConnection,
	getConnectionCredentials,
	listConnections,
	mcpPrefixedToolName,
	upsertConnection,
	writeConnectionCredentials,
} from "@toby/core/integrations/connections";

let tempDir: string;
let previousTobyDir: string | undefined;

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-connections-test-"));
	previousTobyDir = process.env.TOBY_DIR;
	process.env.TOBY_DIR = tempDir;
	clearCredentialsCache();
});

afterEach(() => {
	clearCredentialsCache();
	if (previousTobyDir === undefined) {
		Reflect.deleteProperty(process.env, "TOBY_DIR");
	} else {
		process.env.TOBY_DIR = previousTobyDir;
	}
	fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("connection identity", () => {
	it("lists singleton plugins as connections after hydration", () => {
		fs.writeFileSync(
			getConfigPath(),
			JSON.stringify({
				integrations: {
					jira: {
						connectedAt: "2026-02-01T00:00:00.000Z",
						pluginVersion: "2.0.0",
					},
				},
			}),
		);
		const listed = listConnections();
		expect(listed).toHaveLength(1);
		expect(listed[0]).toMatchObject({
			id: "jira",
			type: "jira",
			displayName: "jira",
			connectedAt: "2026-02-01T00:00:00.000Z",
		});
	});

	it("upserts a singleton connection and dual-writes integrations", () => {
		upsertConnection("slack", {
			type: "slack",
			displayName: "Slack",
			connectedAt: "2026-03-01T00:00:00.000Z",
			pluginVersion: "1.2.3",
		});
		const config = readConfig();
		expect(config.connections?.slack?.displayName).toBe("Slack");
		expect(config.integrations.slack.connectedAt).toBe(
			"2026-03-01T00:00:00.000Z",
		);
		expect(getConnection("slack")?.pluginVersion).toBe("1.2.3");
	});

	it("stores MCP servers as additional connections without a plugin slot", () => {
		const id = allocateMcpConnectionId("GitHub");
		expect(id).toBe("mcp_github");
		upsertConnection(id, {
			type: "mcp",
			displayName: "GitHub",
			transport: "http",
			url: "https://api.githubcopilot.com/mcp/",
			authMethod: "oauth",
		});
		expect(readConfig().integrations[id]).toBeUndefined();
		expect(listConnections().map((c) => c.id)).toContain(id);
	});

	it("uniquifies MCP connection ids", () => {
		upsertConnection("mcp_github", {
			type: "mcp",
			displayName: "GitHub",
			transport: "stdio",
			command: "npx",
		});
		expect(allocateMcpConnectionId("GitHub")).toBe("mcp_github_2");
	});

	it("prefixes MCP tool names with the connection id", () => {
		expect(mcpPrefixedToolName("mcp_github", "search")).toBe(
			"mcp_github_search",
		);
		expect(mcpPrefixedToolName("mcp_github", "get-issue")).toBe(
			"mcp_github_get_issue",
		);
	});

	it("keeps MCP secrets under credentials.connections only", () => {
		writeConnectionCredentials(
			"mcp_github",
			{ bearerToken: "secret-token" },
			{ dualWriteIntegrations: false },
		);
		const creds = readCredentials();
		expect(creds.connections?.mcp_github?.bearerToken).toBe("secret-token");
		expect(creds.integrations?.mcp_github).toBeUndefined();
		expect(getConnectionCredentials("mcp_github").bearerToken).toBe(
			"secret-token",
		);
	});

	it("dual-writes singleton plugin credentials", () => {
		writeConnectionCredentials("todoist", { apiKey: "tok" });
		const creds = readCredentials();
		expect(creds.connections?.todoist?.apiKey).toBe("tok");
		expect(creds.integrations?.todoist?.apiKey).toBe("tok");
	});

	it("deleteConnection removes config and credentials on both keys", () => {
		writeConfig({
			integrations: {
				slack: { connectedAt: "2026-01-01T00:00:00.000Z" },
			},
			connections: {
				slack: {
					type: "slack",
					displayName: "Slack",
					connectedAt: "2026-01-01T00:00:00.000Z",
				},
			},
			personas: [],
		});
		writeCredentials({
			integrations: { slack: { botToken: "x" } },
			connections: { slack: { botToken: "x" } },
		});
		deleteConnection("slack");
		expect(getConnection("slack")).toBeUndefined();
		expect(readConfig().integrations.slack).toBeUndefined();
		expect(readCredentials().integrations?.slack).toBeUndefined();
		expect(readCredentials().connections?.slack).toBeUndefined();
	});
});
