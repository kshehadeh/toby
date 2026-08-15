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

const hnFixture = {
	nbHits: 1,
	hits: [
		{
			objectID: "12345",
			title: "Show HN: Example",
			url: "https://example.com/hn",
			author: "pg",
			created_at: "2026-08-15T12:00:00.000Z",
			points: 42,
			num_comments: 7,
			_tags: ["story", "show_hn", "author_pg"],
		},
	],
};

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
		expect(body.resources).toEqual(["news", "headlines", "hacker-news"]);
		expect(body.chatModelPrep).toBeDefined();
		expect(body.chatReadiness).toEqual({
			ok: false,
			hint: "Run `toby connect news`. Hacker News works with no key; add a Guardian API key only if you also want world news.",
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

	it("returns config shape with optional Guardian key and default source", async () => {
		const result = await runPlugin(["config", "shape"]);
		expect(result.exitCode).toBe(0);
		const body = parseJson(result.stdout) as {
			ok: boolean;
			fields: Array<{ key: string; required?: boolean }>;
		};
		expect(body.ok).toBe(true);
		expect(body.fields.map((field) => field.key)).toEqual([
			"defaultSource",
			"apiKey",
			"defaultSection",
		]);
		expect(body.fields.find((field) => field.key === "apiKey")?.required).toBe(
			false,
		);
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
			"Would fetch the latest headlines from the selected news sources.",
		);
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
			"hacker-news",
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

describe("News plugin against mock news APIs", () => {
	let guardianServer: ReturnType<typeof Bun.serve> | undefined;
	let hnServer: ReturnType<typeof Bun.serve> | undefined;
	let previousGuardianBase: string | undefined;
	let previousHnBase: string | undefined;

	beforeEach(() => {
		previousGuardianBase = process.env.TOBY_NEWS_API_BASE;
		previousHnBase = process.env.TOBY_HN_API_BASE;
	});

	afterEach(() => {
		guardianServer?.stop(true);
		hnServer?.stop(true);
		guardianServer = undefined;
		hnServer = undefined;
		if (previousGuardianBase === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_NEWS_API_BASE");
		} else {
			process.env.TOBY_NEWS_API_BASE = previousGuardianBase;
		}
		if (previousHnBase === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_HN_API_BASE");
		} else {
			process.env.TOBY_HN_API_BASE = previousHnBase;
		}
	});

	function startGuardian(handler: (request: Request) => Response) {
		guardianServer = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: handler,
		});
		return `http://127.0.0.1:${guardianServer.port}`;
	}

	function startHn(
		handler: (request: Request) => Response = () => Response.json(hnFixture),
	) {
		hnServer = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: handler,
		});
		return `http://127.0.0.1:${hnServer.port}`;
	}

	it("connects with Hacker News when no Guardian key is set", async () => {
		const hnBase = startHn();
		const result = await runPlugin(["connect"], {
			stdin: { config: {} },
			env: { TOBY_HN_API_BASE: hnBase },
		});
		expect(result.exitCode).toBe(0);
		expect(parseJson(result.stdout)).toEqual({
			ok: true,
			reason:
				"News connected (Hacker News). Add a Guardian API key later for world news.",
		});
	});

	it("connects to both sources when the Guardian key is valid", async () => {
		const guardianBase = startGuardian(() => Response.json(guardianFixture));
		const hnBase = startHn();
		const result = await runPlugin(["connect"], {
			stdin: { config: { apiKey: "test-key" } },
			env: {
				TOBY_NEWS_API_BASE: guardianBase,
				TOBY_HN_API_BASE: hnBase,
			},
		});
		expect(result.exitCode).toBe(0);
		expect(parseJson(result.stdout)).toEqual({
			ok: true,
			reason: "News connected (The Guardian and Hacker News).",
		});
	});

	it("executes getLatestNews against Hacker News", async () => {
		const hnBase = startHn((request) => {
			const url = new URL(request.url);
			expect(url.pathname).toBe("/search");
			expect(url.searchParams.get("tags")).toBe("front_page");
			return Response.json(hnFixture);
		});
		const result = await runPlugin(["tools", "execute"], {
			stdin: {
				tool: "getLatestNews",
				input: { source: "hacker-news", limit: 3 },
				config: {},
			},
			env: { TOBY_HN_API_BASE: hnBase },
		});
		expect(result.exitCode).toBe(0);
		const body = parseJson(result.stdout) as {
			ok: boolean;
			result: {
				count: number;
				articles: Array<{ title: string; source: string }>;
			};
		};
		expect(body.ok).toBe(true);
		expect(body.result.count).toBe(1);
		expect(body.result.articles[0]?.title).toBe("Show HN: Example");
		expect(body.result.articles[0]?.source).toBe("Hacker News");
	});

	it("executes getLatestNews against The Guardian", async () => {
		const guardianBase = startGuardian((request) => {
			const url = new URL(request.url);
			expect(url.pathname).toBe("/search");
			expect(url.searchParams.get("api-key")).toBe("test-key");
			return Response.json(guardianFixture);
		});
		const result = await runPlugin(["tools", "execute"], {
			stdin: {
				tool: "getLatestNews",
				input: { source: "guardian", limit: 3 },
				config: { apiKey: "test-key" },
			},
			env: { TOBY_NEWS_API_BASE: guardianBase },
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

	it("rejects an invalid Guardian API key from connect", async () => {
		const guardianBase = startGuardian(() =>
			Response.json(
				{ response: { message: "Invalid authentication credentials" } },
				{ status: 403 },
			),
		);
		const hnBase = startHn();
		const result = await runPlugin(["connect"], {
			stdin: { config: { apiKey: "bad-key" } },
			env: {
				TOBY_NEWS_API_BASE: guardianBase,
				TOBY_HN_API_BASE: hnBase,
			},
		});
		expect(result.exitCode).toBe(0);
		const body = parseJson(result.stdout);
		expect(body.ok).toBe(false);
		expect(String(body.reason)).toContain("Invalid authentication credentials");
	});
});
