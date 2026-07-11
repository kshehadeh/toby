/**
 * Diagnostic script for the toby-plugin-jira plugin (bun-package).
 *
 * Reads Jira credentials from the user's Toby data directory
 * (default: ~/.toby/credentials.json, integrations.jira).
 *
 * Run from repo root:
 *   bun run test:jira-plugin --filter @toby/helper-scripts
 *
 * Options:
 *   --toby-dir <path> Override Toby data dir (default: ~/.toby)
 *   --plugin <path>   Override plugin directory path
 *   --dry-run         Execute tools in dry-run mode only
 *   --skip-connect    Skip the connect handshake test
 *   --jql <query>     JQL for searchJiraIssues (default: assignee = currentUser() ORDER BY updated DESC)
 *   --issue <key>     Issue key for getJiraIssue / getJiraIssueComments
 *   --verbose         Print full JSON responses
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	getCredentialsPath,
	getIntegrationCredential,
	readConfig,
	readCredentials,
} from "@toby/core/config/index";
import {
	type PluginInvokeResult,
	pluginConfigGet,
	pluginConnect,
	pluginStatus,
	pluginToolsExecute,
	pluginToolsList,
} from "@toby/core/integrations/plugins/client";
import { findPluginBinary } from "@toby/core/integrations/plugins/discovery";
import { migrateLegacyPluginCredentials } from "@toby/core/integrations/plugins/migrate";
import type { PluginInvocationTarget } from "@toby/core/integrations/plugins/protocol";
import { resolvePluginTarget } from "@toby/core/integrations/plugins/runtime";

function resolveTobyDirFromArgv(argv: string[]): string {
	const idx = argv.indexOf("--toby-dir");
	if (idx !== -1 && argv[idx + 1]) {
		return path.resolve(argv[idx + 1]);
	}
	return path.join(os.homedir(), ".toby");
}

// Default to the real user ~/.toby dir (not a test TOBY_DIR from the shell).
const TOBY_DIR = resolveTobyDirFromArgv(process.argv.slice(2));
process.env.TOBY_DIR = TOBY_DIR;
migrateLegacyPluginCredentials();

type CliOptions = {
	tobyDir: string;
	pluginDir?: string;
	dryRun: boolean;
	skipConnect: boolean;
	jql: string;
	issueKey?: string;
	verbose: boolean;
};

type TestResult = {
	name: string;
	ok: boolean;
	detail: string;
	result?: unknown;
};

function printHelp(): never {
	console.log(`Usage: bun src/test-jira-plugin.ts [options]

Reads credentials from <toby-dir>/credentials.json (default: ~/.toby).

Options:
  --toby-dir <path> Override Toby data dir (default: ~/.toby)
  --plugin <path>   Override plugin directory path
  --dry-run         Execute tools in dry-run mode only
  --skip-connect    Skip the connect handshake test
  --jql <query>     JQL for searchJiraIssues
  --issue <key>     Issue key for getJiraIssue / getJiraIssueComments
  --verbose         Print full JSON responses
`);
	process.exit(0);
}

function parseArgs(argv: string[]): CliOptions {
	const options: CliOptions = {
		tobyDir: TOBY_DIR,
		dryRun: false,
		skipConnect: false,
		jql: "assignee = currentUser() ORDER BY updated DESC",
		verbose: false,
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") {
			printHelp();
		}
		switch (arg) {
			case "--toby-dir":
				i++;
				break;
			case "--plugin":
				options.pluginDir = argv[++i];
				break;
			case "--dry-run":
				options.dryRun = true;
				break;
			case "--skip-connect":
				options.skipConnect = true;
				break;
			case "--jql":
				options.jql = argv[++i] ?? options.jql;
				break;
			case "--issue":
				options.issueKey = argv[++i];
				break;
			case "--verbose":
				options.verbose = true;
				break;
			default:
				console.error(`Unknown argument: ${arg}`);
				process.exit(2);
		}
	}

	return options;
}

function buildJiraHost(domain: string): string {
	let normalized = domain.trim();
	normalized = normalized.replace(/^https?:\/\//, "");
	while (normalized.endsWith("/")) {
		normalized = normalized.slice(0, -1);
	}
	if (normalized.endsWith(".atlassian.net")) {
		return `https://${normalized}`;
	}
	return `https://${normalized}.atlassian.net`;
}

function resolveJiraPluginTarget(explicit?: string): PluginInvocationTarget {
	if (explicit) {
		if (!fs.existsSync(explicit)) {
			throw new Error(`Plugin directory not found: ${explicit}`);
		}
		if (!fs.existsSync(path.join(explicit, "manifest.json"))) {
			throw new Error(`No manifest.json in: ${explicit}`);
		}
		return resolvePluginTarget({
			kind: "bun-package",
			binaryName: "toby-plugin-jira",
			directoryPath: explicit,
			manifestPath: path.join(explicit, "manifest.json"),
			entryPath: path.join(explicit, "src/index.ts"),
		});
	}

	const fromEnv = process.env.TOBY_PLUGIN_JIRA_DIR?.trim();
	if (fromEnv && fs.existsSync(fromEnv)) {
		return resolvePluginTarget({
			kind: "bun-package",
			binaryName: "toby-plugin-jira",
			directoryPath: fromEnv,
			manifestPath: path.join(fromEnv, "manifest.json"),
			entryPath: path.join(fromEnv, "src/index.ts"),
		});
	}

	const discovered = findPluginBinary("jira");
	if (discovered) {
		return resolvePluginTarget(discovered);
	}

	const repoRoot = path.resolve(import.meta.dirname, "../../..");
	const candidates = [
		path.join(repoRoot, "dist/toby-plugin-jira"),
		path.join(repoRoot, "apps/plugin-jira"),
	];
	for (const candidate of candidates) {
		if (
			fs.existsSync(candidate) &&
			fs.existsSync(path.join(candidate, "manifest.json"))
		) {
			return resolvePluginTarget({
				kind: "bun-package",
				binaryName: "toby-plugin-jira",
				directoryPath: candidate,
				manifestPath: path.join(candidate, "manifest.json"),
				entryPath: path.join(candidate, "src/index.ts"),
			});
		}
	}

	throw new Error(
		"toby-plugin-jira not found. Install to ~/.toby/plugins, set TOBY_PLUGIN_JIRA_DIR, or run: bun run build:plugin:jira",
	);
}

function loadJiraPluginConfig(
	credentialsPath: string,
): Record<string, unknown> {
	if (!fs.existsSync(credentialsPath)) {
		console.error(`Credentials file not found: ${credentialsPath}`);
		console.error("Run `toby configure` to set up Jira credentials.");
		process.exit(1);
	}

	const creds = readCredentials();
	const fromIntegrations = creds.integrations?.jira;
	if (fromIntegrations && Object.keys(fromIntegrations).length > 0) {
		return { ...fromIntegrations };
	}

	const legacy = (creds as Record<string, Record<string, string> | undefined>)
		.jira;
	if (legacy && typeof legacy === "object") {
		return { ...(legacy as Record<string, string>) };
	}

	console.error(
		`Missing Jira credentials in ${credentialsPath}. Expected integrations.jira with domain, email, and apiToken.`,
	);
	process.exit(1);
}

function loadJiraPluginState(): Record<string, unknown> {
	const config = readConfig();
	const state = config.integrations?.jira;
	return state && typeof state === "object" ? { ...state } : {};
}

function printInvokeFailure(
	label: string,
	result: {
		error: string;
		code: string;
		stderr: string;
		exitCode: number | null;
	},
): void {
	console.error(`FAILED: ${label}`);
	console.error(`  error: ${result.error}`);
	console.error(`  code: ${result.code}`);
	if (result.stderr) {
		console.error(`  stderr: ${result.stderr}`);
	}
	if (result.exitCode !== null) {
		console.error(`  exitCode: ${result.exitCode}`);
	}
}

function printPluginResponse<T extends { ok: boolean }>(
	label: string,
	result: PluginInvokeResult<T>,
	verbose: boolean,
): TestResult {
	if (!result.ok) {
		printInvokeFailure(label, result);
		return { name: label, ok: false, detail: result.error };
	}

	if (!result.data.ok) {
		const payload = result.data as {
			reason?: string;
			error?: string;
			details?: string;
		};
		const detail =
			payload.reason ??
			payload.details ??
			payload.error ??
			"plugin returned ok:false";
		console.error(`FAILED: ${label}`);
		console.error(`  ${detail}`);
		if (verbose) {
			console.error(JSON.stringify(result.data, null, 2));
		}
		return { name: label, ok: false, detail };
	}

	console.log(`OK: ${label}`);
	if (verbose) {
		console.log(JSON.stringify(result.data, null, 2));
	}
	return { name: label, ok: true, detail: "ok" };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

type CredentialFingerprint = {
	readonly present: boolean;
	readonly length?: number;
	readonly prefix?: string;
	readonly sha256?: string;
};

function fingerprintCredential(value: unknown): CredentialFingerprint {
	if (typeof value !== "string" || value.length === 0) {
		return { present: false };
	}
	return {
		present: true,
		length: value.length,
		prefix: value.slice(0, 8),
		sha256: crypto
			.createHash("sha256")
			.update(value)
			.digest("hex")
			.slice(0, 16),
	};
}

function summarizeCredentialBlock(
	block: Record<string, unknown> | undefined,
): Record<string, unknown> {
	return {
		keys: Object.keys(block ?? {}).sort(),
		domain: fingerprintCredential(block?.domain),
		email: fingerprintCredential(block?.email),
		apiToken: fingerprintCredential(block?.apiToken),
	};
}

function credentialFieldsMatch(
	left: Record<string, unknown> | undefined,
	right: Record<string, unknown> | undefined,
): boolean {
	return (["domain", "email", "apiToken"] as const).every((field) => {
		const a = left?.[field];
		const b = right?.[field];
		return typeof a === "string" && typeof b === "string" && a === b;
	});
}

function verifyCredentialPipeline(
	credentialsPath: string,
	target: PluginInvocationTarget,
	envelope: { config: Record<string, unknown>; state: Record<string, unknown> },
	verbose: boolean,
): TestResult {
	// Prefer readCredentials so encrypted-on-disk envelopes are decrypted.
	const onDisk = readCredentials() as {
		integrations?: Record<string, Record<string, unknown>>;
		jira?: Record<string, unknown>;
	};
	const diskJira = onDisk.integrations?.jira ?? onDisk.jira ?? {};
	const readJira = onDisk.integrations?.jira ?? {};
	const stdinConfig = JSON.parse(
		JSON.stringify({
			config: envelope.config,
			state: envelope.state,
		}),
	).config as Record<string, unknown>;

	const pluginEcho = pluginConfigGet(target, envelope);
	const pluginConfig =
		pluginEcho.ok && pluginEcho.data.ok && pluginEcho.data.config
			? (pluginEcho.data.config as Record<string, unknown>)
			: undefined;

	console.log("--- Credential pipeline verification ---");
	console.log(`credentials.json: ${credentialsPath}`);
	console.log("Fingerprints (length / prefix / sha256) — not full secrets.");
	console.log("");
	console.log("1) On disk (integrations.jira):");
	console.log(JSON.stringify(summarizeCredentialBlock(diskJira), null, 2));
	console.log("");
	console.log("2) readCredentials().integrations.jira:");
	console.log(JSON.stringify(summarizeCredentialBlock(readJira), null, 2));
	console.log("");
	console.log("3) Envelope config sent to plugin:");
	console.log(
		JSON.stringify(summarizeCredentialBlock(envelope.config), null, 2),
	);
	console.log("");
	console.log("4) Plugin echoed config (config get):");
	if (pluginConfig) {
		console.log(
			JSON.stringify(summarizeCredentialBlock(pluginConfig), null, 2),
		);
	} else {
		console.log("  unavailable");
		if (verbose) {
			console.log(JSON.stringify(pluginEcho, null, 2));
		}
	}

	const checks = [
		["disk -> readCredentials", credentialFieldsMatch(diskJira, readJira)],
		[
			"readCredentials -> envelope",
			credentialFieldsMatch(readJira, envelope.config),
		],
		[
			"envelope -> stdin JSON",
			credentialFieldsMatch(envelope.config, stdinConfig),
		],
		[
			"stdin -> plugin echo",
			pluginConfig ? credentialFieldsMatch(stdinConfig, pluginConfig) : false,
		],
	] as const;

	console.log("");
	for (const [label, ok] of checks) {
		console.log(`  ${label}: ${ok ? "MATCH" : "MISMATCH"}`);
	}

	const pass = checks.every(([, ok]) => ok);
	console.log("");
	if (pass) {
		console.log(
			"Credentials match end-to-end: plugin receives the same values as credentials.json.",
		);
		return {
			name: "credential pipeline",
			ok: true,
			detail: "disk/read/envelope/plugin match",
		};
	}

	console.log("Credential mismatch detected in Toby -> plugin pipeline.");
	return {
		name: "credential pipeline",
		ok: false,
		detail: checks
			.filter(([, ok]) => !ok)
			.map(([label]) => label)
			.join(", "),
	};
}

function basicAuthHeader(email: string, apiToken: string): string {
	const encoded = Buffer.from(`${email}:${apiToken}`, "utf8").toString(
		"base64",
	);
	return `Basic ${encoded}`;
}

async function fetchJiraProbe(
	label: string,
	url: string,
	authHeader?: string,
	init?: RequestInit,
): Promise<{ label: string; status: number; body: string }> {
	const headers = new Headers(init?.headers);
	headers.set("Accept", "application/json");
	if (authHeader) {
		headers.set("Authorization", authHeader);
	}
	const response = await fetch(url, { ...init, headers });
	const body = await response.text();
	return { label, status: response.status, body };
}

async function resolveCloudId(siteHost: string): Promise<string | undefined> {
	try {
		const response = await fetch(`${siteHost}/_edge/tenant_info`);
		if (!response.ok) return undefined;
		const json = (await response.json()) as { cloudId?: string };
		return typeof json.cloudId === "string" ? json.cloudId : undefined;
	} catch {
		return undefined;
	}
}

async function runConnectAuthProbe(
	siteHost: string,
	email: string,
	apiToken: string,
	verbose: boolean,
): Promise<TestResult> {
	console.log("--- Connect auth probe (HTTP) ---");
	console.log(
		"toby connect jira validates GET /rest/api/3/myself — the only probe here that rejects bad credentials.",
	);
	console.log();

	const auth = basicAuthHeader(email, apiToken);
	const probes = [
		await fetchJiraProbe(
			"myself (authenticated)",
			`${siteHost}/rest/api/3/myself`,
			auth,
		),
		await fetchJiraProbe("myself (no auth)", `${siteHost}/rest/api/3/myself`),
		await fetchJiraProbe(
			"project/search (authenticated)",
			`${siteHost}/rest/api/3/project/search?maxResults=5`,
			auth,
		),
		await fetchJiraProbe(
			"project/search (no auth)",
			`${siteHost}/rest/api/3/project/search?maxResults=5`,
		),
		await fetchJiraProbe(
			"search/jql (authenticated)",
			`${siteHost}/rest/api/3/search/jql`,
			auth,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					jql: "assignee = currentUser() ORDER BY updated DESC",
					maxResults: 3,
					fields: ["summary"],
					fieldsByKeys: true,
				}),
			},
		),
	];

	for (const probe of probes) {
		const snippet = probe.body.replace(/\s+/g, " ").slice(0, 160);
		console.log(`${probe.label}: HTTP ${probe.status} — ${snippet}`);
		if (verbose) {
			console.log(probe.body);
		}
	}

	const myself = probes[0];
	const projectNoAuth = probes[3];
	const projectAuth = probes[2];
	const falsePositiveTools =
		myself.status === 401 &&
		projectNoAuth.status === 200 &&
		projectAuth.body === projectNoAuth.body;

	if (falsePositiveTools) {
		console.log();
		console.log(
			"NOTE: project/search and search/jql return HTTP 200 with empty data even when auth fails.",
		);
		console.log(
			"Plugin tool tests can look successful while connect correctly fails on /myself.",
		);
	}

	const cloudId = await resolveCloudId(siteHost);
	if (cloudId) {
		const gatewayHost = `https://api.atlassian.com/ex/jira/${cloudId}`;
		const gatewayMyself = await fetchJiraProbe(
			"gateway myself (authenticated)",
			`${gatewayHost}/rest/api/3/myself`,
			auth,
		);
		const snippet = gatewayMyself.body.replace(/\s+/g, " ").slice(0, 160);
		console.log(
			`${gatewayMyself.label}: HTTP ${gatewayMyself.status} — ${snippet}`,
		);
		if (gatewayMyself.status === 200 && myself.status === 401) {
			console.log();
			console.log(
				"HINT: Scoped API tokens must use https://api.atlassian.com/ex/jira/{cloudId}/… instead of the site URL.",
			);
			console.log(`      cloudId: ${cloudId}`);
		}
	}

	console.log();
	if (myself.status === 200) {
		console.log("Connect should succeed: /myself authenticated successfully.");
		return { name: "connect auth probe", ok: true, detail: "myself OK" };
	}

	console.log("Connect fails because /myself returns HTTP 401.");
	console.log("Likely causes:");
	console.log(
		"  - API token expired or revoked (Atlassian tokens now expire after up to 1 year)",
	);
	console.log(
		"  - Email does not match the Atlassian account that created the token",
	);
	console.log(
		"  - Scoped token used against the site URL instead of api.atlassian.com/ex/jira/{cloudId}",
	);
	console.log("Next steps:");
	console.log(
		"  1. Create a new token at https://id.atlassian.com/manage-profile/security/api-tokens",
	);
	console.log(
		"  2. Update credentials in `toby configure` or ~/.toby/credentials.json",
	);
	console.log("  3. Re-run this script");
	console.log();

	return {
		name: "connect auth probe",
		ok: false,
		detail: `myself HTTP ${myself.status}: ${myself.body.slice(0, 120)}`,
	};
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const credentialsPath = getCredentialsPath();
	const target = resolveJiraPluginTarget(options.pluginDir);
	const creds = readCredentials();
	const config = loadJiraPluginConfig(credentialsPath);
	const state = loadJiraPluginState();

	const domain =
		getIntegrationCredential(creds, "jira", "domain") ??
		String(config.domain ?? "");
	const email =
		getIntegrationCredential(creds, "jira", "email") ??
		String(config.email ?? "");
	const apiToken =
		getIntegrationCredential(creds, "jira", "apiToken") ??
		String(config.apiToken ?? "");

	console.log("=== Jira Plugin Diagnostic ===");
	console.log(`Toby dir:       ${options.tobyDir}`);
	console.log(`Credentials:    ${credentialsPath}`);
	console.log(
		`Plugin:         ${target.kind === "bun-package" ? target.cwd : target.executablePath}`,
	);
	console.log(`Domain:  ${domain}`);
	console.log(`Email:   ${email}`);
	console.log(
		`Token:   ${apiToken ? `${apiToken.slice(0, 8)}...` : "(missing)"}`,
	);
	console.log(`Host:    ${domain ? buildJiraHost(domain) : "(unknown)"}`);
	console.log(`Dry run: ${options.dryRun}`);
	console.log();

	const results: TestResult[] = [];
	const envelope = { config, state };
	const siteHost = domain ? buildJiraHost(domain) : "";

	results.push(
		verifyCredentialPipeline(
			credentialsPath,
			target,
			envelope,
			options.verbose,
		),
	);

	if (!options.skipConnect && siteHost && email && apiToken) {
		results.push(
			await runConnectAuthProbe(siteHost, email, apiToken, options.verbose),
		);
	}

	results.push(
		printPluginResponse(
			"status",
			pluginStatus(target, envelope),
			options.verbose,
		),
	);

	if (!options.skipConnect) {
		results.push(
			printPluginResponse(
				"connect (plugin)",
				pluginConnect(target, envelope),
				options.verbose,
			),
		);
	}

	const toolsList = pluginToolsList(target);
	if (!toolsList.ok) {
		printInvokeFailure("tools list", toolsList);
		results.push({ name: "tools list", ok: false, detail: toolsList.error });
	} else if (!toolsList.data.ok) {
		const detail = toolsList.data.error ?? "tools list returned ok:false";
		console.error("FAILED: tools list");
		console.error(`  ${detail}`);
		results.push({ name: "tools list", ok: false, detail });
	} else {
		const names = toolsList.data.tools?.map((tool) => tool.name) ?? [];
		console.log(`OK: tools list (${names.join(", ")})`);
		if (options.verbose) {
			console.log(JSON.stringify(toolsList.data.tools, null, 2));
		}
		results.push({ name: "tools list", ok: true, detail: names.join(", ") });
	}

	const executeTool = (
		tool: string,
		input: Record<string, unknown>,
		label = tool,
	): TestResult => {
		const result = pluginToolsExecute(target, {
			tool,
			input,
			config,
			state,
			dryRun: options.dryRun,
		});
		if (!result.ok) {
			printInvokeFailure(label, result);
			return { name: label, ok: false, detail: result.error };
		}
		if (!result.data.ok) {
			const detail = result.data.error ?? "tool returned ok:false";
			console.error(`FAILED: ${label}`);
			console.error(`  ${detail}`);
			return { name: label, ok: false, detail };
		}

		console.log(`OK: ${label}`);
		if (result.data.appliedActions?.length) {
			for (const action of result.data.appliedActions) {
				console.log(`  ${action}`);
			}
		}
		if (options.verbose) {
			console.log(JSON.stringify(result.data.result, null, 2));
		}
		return {
			name: label,
			ok: true,
			detail: "ok",
			result: result.data.result,
		};
	};

	console.log();
	console.log("--- Tool: listJiraProjects ---");
	const projectsResult = executeTool("listJiraProjects", { maxResults: 5 });
	results.push(projectsResult);

	console.log();
	console.log("--- Tool: searchJiraIssues ---");
	const searchResult = executeTool("searchJiraIssues", {
		jql: options.jql,
		maxResults: 3,
	});
	results.push(searchResult);

	let issueKey = options.issueKey;
	if (!issueKey) {
		const searchPayload = asRecord(searchResult.result);
		const issues = Array.isArray(searchPayload?.issues)
			? searchPayload.issues
			: [];
		const firstIssue = asRecord(issues[0]);
		issueKey = typeof firstIssue?.key === "string" ? firstIssue.key : undefined;
	}

	if (issueKey) {
		console.log();
		console.log(`--- Tool: getJiraIssue (${issueKey}) ---`);
		results.push(
			executeTool("getJiraIssue", { issueKey }, `getJiraIssue (${issueKey})`),
		);

		console.log();
		console.log(`--- Tool: getJiraIssueComments (${issueKey}) ---`);
		results.push(
			executeTool(
				"getJiraIssueComments",
				{ issueKey, maxResults: 5 },
				`getJiraIssueComments (${issueKey})`,
			),
		);
	} else {
		console.log();
		console.log(
			"SKIP: getJiraIssue / getJiraIssueComments (no issue key available)",
		);
	}

	console.log();
	console.log("=== Summary ===");
	const failed = results.filter((result) => !result.ok);
	for (const result of results) {
		console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name}`);
		if (!result.ok) {
			console.log(`       ${result.detail}`);
		}
	}

	console.log();
	if (failed.length === 0) {
		console.log("All checks passed.");
		process.exit(0);
	}

	console.log(`${failed.length}/${results.length} check(s) failed.`);
	process.exit(1);
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
