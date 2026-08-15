import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import path from "node:path";
import { isBuiltinIntegration } from "@toby/core/integrations/index";
import {
	createPluginIntegrationModule,
	loadPluginMetadata,
} from "@toby/core/integrations/plugins/adapter";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const pluginDir = path.join(repoRoot, "plugin-news");
const pluginEntry = path.join(pluginDir, "src/index.ts");

async function runPlugin(
	args: string[],
	options: {
		stdin?: unknown;
		env?: Record<string, string>;
	} = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn([process.execPath, "run", pluginEntry, ...args], {
		cwd: pluginDir,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			...(options.env ?? {}),
		},
	});
	if (options.stdin !== undefined) {
		proc.stdin.write(JSON.stringify(options.stdin));
	}
	proc.stdin.end();
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return {
		exitCode,
		stdout: stdout.trim(),
		stderr: stderr.trim(),
	};
}

function parseJson(stdout: string): Record<string, unknown> {
	return JSON.parse(stdout) as Record<string, unknown>;
}

const guardianFixture = {
	response: {
		status: "ok",
		total: 1,
		results: [
			{
				id: "world/2026/aug/15/example",
				sectionId: "world",
				sectionName: "World news",
				webPublicationDate: "2026-08-15T12:00:00Z",
				webTitle: "Example headline",
				webUrl: "https://www.theguardian.com/world/2026/aug/15/example",
				fields: {
					trailText: "A short summary.",
					byline: "Ada Lovelace",
				},
			},
		],
	},
};

describe("News plugin", () => {
	it("is not a built-in integration", () => {
		expect(isBuiltinIntegration("news")).toBe(false);
	});

	it("reports status metadata and chat prep", async () => {
		const result = await runPlugin(["status"], { stdin: {} });
		expect(result.exitCode).toBe(0);
		const body = parseJson(result.stdout);
		expect(body.ok).toBe(true);
		expect(body.name).toBe("news");
		expect(body.displayName).toBe("News");
		expect(body.connected).toBe(false);
		expect(body.capabilities).toEqual(["chat"]);
		expect(body.resources).toEqual(["news", "headlines"]);
		expect(body.chatModelPrep).toBeDefined();
		expect(body.chatReadiness).toEqual({
			ok: false,
			hint: "Add a free Guardian Open Platform API key in `toby configure`, then run `toby connect news`.",
		});
	});

	it("lists the expected read-only news tools", async () => {
		const result = await runPlugin(["tools", "list"]);
		expect(result.exitCode).toBe(0);
		const body = parseJson(result.stdout) as {
			ok: boolean;
			tools: Array<{ name: string; readOnly?: boolean }>;
		};
		expect(body.ok).toBe(true);
		expect(body.tools.map((tool) => tool.name)).toEqual([
			"getLatestNews",
			"searchNews",
		]);
		expect(body.tools.every((tool) => tool.readOnly)).toBe(true);
	});

	it("returns config shape with API key and default section", async () => {
		const result = await runPlugin(["config", "shape"]);
		expect(result.exitCode).toBe(0);
		const body = parseJson(result.stdout) as {
			ok: boolean;
			fields: Array<{ key: string; required?: boolean }>;
		};
		expect(body.ok).toBe(true);
		expect(body.fields.map((field) => field.key)).toEqual([
			"apiKey",
			"defaultSection",
		]);
		expect(body.fields[0]?.required).toBe(true);
	});

	it("honors dryRun without calling the Guardian API", async () => {
		const result = await runPlugin(["tools", "execute"], {
			stdin: {
				tool: "getLatestNews",
				input: { section: "world" },
				dryRun: true,
			},
		});
		expect(result.exitCode).toBe(0);
		const body = parseJson(result.stdout) as {
			ok: boolean;
			result: { dryRun?: boolean; message?: string };
		};
		expect(body.ok).toBe(true);
		expect(body.result.dryRun).toBe(true);
		expect(body.result.message).toBe(
			"Would fetch the latest Guardian headlines.",
		);
	});

	it("connect fails clearly when the API key is missing", async () => {
		const result = await runPlugin(["connect"], { stdin: { config: {} } });
		expect(result.exitCode).toBe(0);
		const body = parseJson(result.stdout);
		expect(body.ok).toBe(false);
		expect(String(body.reason)).toContain("API key is required");
	});

	it("returns a setup guide for the native app", async () => {
		const result = await runPlugin(["setup", "guide"]);
		expect(result.exitCode).toBe(0);
		const body = parseJson(result.stdout) as {
			ok: boolean;
			name: string;
			steps: Array<{ id: string }>;
		};
		expect(body.ok).toBe(true);
		expect(body.name).toBe("news");
		expect(body.steps.map((step) => step.id)).toEqual([
			"overview",
			"provider",
			"credentials",
			"auth",
			"validate",
		]);
	});

	it("loads as an IntegrationModule with chat capability", () => {
		const metadata = loadPluginMetadata({
			kind: "bun-package",
			binaryName: "toby-plugin-news",
			directoryPath: pluginDir,
			manifestPath: path.join(pluginDir, "manifest.json"),
			entryPath: pluginEntry,
		});
		expect("error" in metadata).toBe(false);
		if ("error" in metadata) return;
		const mod = createPluginIntegrationModule(metadata);
		expect(mod.name).toBe("news");
		expect(mod.capabilities).toContain("chat");
	});
});

describe("News plugin against a mock Guardian API", () => {
	let server: ReturnType<typeof Bun.serve> | undefined;
	let previousBase: string | undefined;

	beforeEach(() => {
		previousBase = process.env.TOBY_NEWS_API_BASE;
	});

	afterEach(() => {
		server?.stop(true);
		server = undefined;
		if (previousBase === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_NEWS_API_BASE");
		} else {
			process.env.TOBY_NEWS_API_BASE = previousBase;
		}
	});

	it("connects when the Guardian API accepts the key", async () => {
		server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch() {
				return Response.json(guardianFixture);
			},
		});
		const result = await runPlugin(["connect"], {
			stdin: { config: { apiKey: "test-key" } },
			env: { TOBY_NEWS_API_BASE: `http://127.0.0.1:${server.port}` },
		});
		expect(result.exitCode).toBe(0);
		expect(parseJson(result.stdout)).toEqual({
			ok: true,
			reason: "News connected successfully.",
		});
	});

	it("executes getLatestNews against the mock API", async () => {
		server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch(request) {
				const url = new URL(request.url);
				expect(url.pathname).toBe("/search");
				expect(url.searchParams.get("api-key")).toBe("test-key");
				return Response.json(guardianFixture);
			},
		});
		const result = await runPlugin(["tools", "execute"], {
			stdin: {
				tool: "getLatestNews",
				input: { limit: 3 },
				config: { apiKey: "test-key" },
			},
			env: { TOBY_NEWS_API_BASE: `http://127.0.0.1:${server.port}` },
		});
		expect(result.exitCode).toBe(0);
		const body = parseJson(result.stdout) as {
			ok: boolean;
			result: { count: number; articles: Array<{ title: string }> };
		};
		expect(body.ok).toBe(true);
		expect(body.result.count).toBe(1);
		expect(body.result.articles[0]?.title).toBe("Example headline");
	});

	it("rejects an invalid API key from connect", async () => {
		server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch() {
				return Response.json(
					{ response: { message: "Invalid authentication credentials" } },
					{ status: 403 },
				);
			},
		});
		const result = await runPlugin(["connect"], {
			stdin: { config: { apiKey: "bad-key" } },
			env: { TOBY_NEWS_API_BASE: `http://127.0.0.1:${server.port}` },
		});
		expect(result.exitCode).toBe(0);
		const body = parseJson(result.stdout);
		expect(body.ok).toBe(false);
		expect(String(body.reason)).toContain("Invalid authentication credentials");
	});
});
