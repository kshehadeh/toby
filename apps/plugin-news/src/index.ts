#!/usr/bin/env bun
/**
 * News installable Toby plugin (protocol v1, bun-package).
 *
 * Fetches latest headlines and searches recent articles from Hacker News
 * (Algolia HN API, no key) and The Guardian Open Platform (optional key).
 */

import {
	NEWS_SECTION_OPTIONS,
	NEWS_SOURCE_IDS,
	hasNewsApiKey,
	normalizeConfig,
	testNewsConnection,
} from "./client";
import { buildChatModelPrep, buildChatReadiness } from "./prompts";
import { emitError, emitJson, parseEnvelope, readStdin } from "./protocol";
import { TOOL_DEFINITIONS, ToolFailure, executeTool } from "./tools";

type JsonRecord = Record<string, unknown>;

const PLUGIN_VERSION = "1.1.0";
const PROTOCOL_VERSION = "1";
const DISPLAY_NAME = "News";
const DESCRIPTION =
	"Get the latest headlines and search recent news from Hacker News and The Guardian";
const RESOURCES = ["news", "headlines", "hacker-news"];

function isConnected(config: JsonRecord, state: JsonRecord): boolean {
	return Boolean(state.connectedAt) || hasNewsApiKey(config);
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function validateNewsTools(
	config: JsonRecord,
): Promise<Array<{ tool: string; ok: boolean; details: string }>> {
	const checks: Array<{ tool: string; ok: boolean; details: string }> = [];
	try {
		const probe = await testNewsConnection(config);
		const sourceList = probe.sources.join(", ");
		checks.push({
			tool: "getLatestNews",
			ok: true,
			details: `Fetched latest headlines (${sourceList}).`,
		});
		checks.push({
			tool: "searchNews",
			ok: true,
			details: `Search uses the same sources (${sourceList}).`,
		});
	} catch (error) {
		const details = toErrorMessage(error);
		checks.push({ tool: "getLatestNews", ok: false, details });
		checks.push({
			tool: "searchNews",
			ok: false,
			details: "Not executed because the news source check failed.",
		});
	}
	return checks;
}

async function handleStatus(
	config: JsonRecord,
	state: JsonRecord,
	validateTools: boolean,
): Promise<never> {
	const connected = isConnected(config, state);
	const payload: JsonRecord = {
		ok: true,
		name: "news",
		displayName: DISPLAY_NAME,
		description: DESCRIPTION,
		version: PLUGIN_VERSION,
		protocolVersion: PROTOCOL_VERSION,
		icon: "📰",
		launchUrl: "https://news.ycombinator.com",
		connected,
		capabilities: ["chat"],
		resources: RESOURCES,
		chatModelPrep: buildChatModelPrep(),
		chatReadiness: buildChatReadiness(config, state),
		details: connected
			? "News sources reachable."
			: "News is not connected. Run `toby connect news` (Hacker News needs no key).",
	};

	if (connected || validateTools) {
		try {
			const probe = await testNewsConnection(config);
			const sourceList = probe.sources.join(" and ");
			payload.details = state.connectedAt
				? `${sourceList} reachable.`
				: `${sourceList} reachable. Run \`toby connect news\` to mark connected, or use chat directly.`;
		} catch (error) {
			payload.ok = false;
			payload.details = `News source check failed: ${toErrorMessage(error)}`;
		}
	}

	if (validateTools) {
		const toolChecks = await validateNewsTools(config);
		payload.tools = toolChecks;
		const failed = toolChecks.filter((check) => check.ok !== true);
		if (failed.length === 0) {
			payload.ok = true;
			payload.details = `News sources reachable; validated ${toolChecks.length} tool check(s).`;
		} else {
			payload.ok = false;
			payload.details = `Connected, but ${failed.length}/${toolChecks.length} tool check(s) failed.`;
		}
	}

	emitJson(payload);
}

async function handleConnect(config: JsonRecord): Promise<never> {
	try {
		const probe = await testNewsConnection(config);
		const sourceList = probe.sources.join(" and ");
		emitJson({
			ok: true,
			reason: hasNewsApiKey(config)
				? `News connected (${sourceList}).`
				: `News connected (${sourceList}). Add a Guardian API key later for world news.`,
		});
	} catch (error) {
		emitJson({
			ok: false,
			reason: `Could not reach news sources: ${toErrorMessage(error)}`,
		});
	}
}

function handleDisconnect(): never {
	emitJson({ ok: true, reason: "News disconnected." });
}

function handleConfigShape(): never {
	emitJson({
		ok: true,
		fields: [
			{
				key: "defaultSource",
				label: "Default source",
				type: "select",
				required: false,
				default: "all",
				options: [...NEWS_SOURCE_IDS],
				description:
					"Used when a tool call does not specify a source. Hacker News needs no key; The Guardian needs an API key.",
			},
			{
				key: "apiKey",
				label: "Guardian API key",
				type: "string",
				required: false,
				masked: true,
				description:
					"Optional. Free key from https://open-platform.theguardian.com/access/ for world news.",
			},
			{
				key: "defaultSection",
				label: "Default Guardian section",
				type: "select",
				required: false,
				default: "all",
				options: [...NEWS_SECTION_OPTIONS],
				description:
					"Used for Guardian requests that do not specify a section.",
			},
		],
	});
}

function handleConfigGet(config: JsonRecord): never {
	emitJson({ ok: true, config: normalizeConfig(config) });
}

function handleConfigSet(): never {
	emitJson({ ok: true, reason: "News config synced." });
}

function handleToolsList(): never {
	emitJson({ ok: true, tools: TOOL_DEFINITIONS });
}

async function handleToolsExecute(body: JsonRecord): Promise<never> {
	const tool = String(body.tool ?? "");
	const input =
		body.input && typeof body.input === "object" && !Array.isArray(body.input)
			? (body.input as JsonRecord)
			: {};
	const config =
		body.config &&
		typeof body.config === "object" &&
		!Array.isArray(body.config)
			? (body.config as JsonRecord)
			: {};

	if (!TOOL_DEFINITIONS.some((definition) => definition.name === tool)) {
		emitJson({ ok: false, error: `Unknown tool: ${tool}` });
	}

	try {
		const { result, appliedActions } = await executeTool(
			tool,
			input,
			config,
			Boolean(body.dryRun),
		);
		const response: JsonRecord = { ok: true, result };
		if (appliedActions.length > 0) {
			response.appliedActions = appliedActions;
		}
		emitJson(response);
	} catch (error) {
		if (error instanceof ToolFailure) {
			emitJson({ ok: false, error: error.message });
		}
		emitJson({
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

function handleSetupGuide(): never {
	emitJson({
		ok: true,
		name: "news",
		displayName: DISPLAY_NAME,
		description: DESCRIPTION,
		steps: [
			{
				id: "overview",
				title: "What News can do in Toby",
				description:
					"Chat can fetch latest headlines and search recent articles from Hacker News (no API key) and The Guardian (optional free API key).",
			},
			{
				id: "hacker-news",
				title: "Hacker News is ready",
				description:
					"Hacker News uses the public Algolia HN Search API. No registration is required. Connect now for the front page, newest stories, Ask HN, and Show HN.",
				links: [
					{
						label: "Hacker News",
						url: "https://news.ycombinator.com",
					},
					{
						label: "HN Search API",
						url: "https://hn.algolia.com/api",
					},
				],
			},
			{
				id: "provider",
				title: "Optional: add The Guardian",
				description:
					"For world, national, science, and culture coverage, register for a free Guardian Open Platform key and paste it below. You can skip this and use Hacker News only.",
				links: [
					{
						label: "Get a free Guardian API key",
						url: "https://open-platform.theguardian.com/access/",
					},
					{
						label: "Guardian API documentation",
						url: "https://open-platform.theguardian.com/documentation/",
					},
				],
			},
			{
				id: "credentials",
				title: "Choose defaults",
				description:
					"Pick a default source (all, hacker-news, or guardian). The Guardian API key is optional. Default section applies only to Guardian requests.",
			},
			{
				id: "auth",
				title: "Connect",
				description:
					"Click Connect. Toby checks Hacker News and, if you added a key, The Guardian, then marks News as connected.",
			},
			{
				id: "validate",
				title: "Validate",
				description:
					"Toby will run a health check against the sources you enabled.",
			},
		],
	});
}

async function main(): Promise<void> {
	const [command, subcommand] = process.argv.slice(2);
	const stdin = await readStdin();

	if (command === "status") {
		const { config, state, validateTools } = parseEnvelope(stdin);
		await handleStatus(config, state, validateTools);
	}

	if (command === "connect") {
		const { config } = parseEnvelope(stdin);
		await handleConnect(config);
	}

	if (command === "disconnect") {
		handleDisconnect();
	}

	if (command === "config" && subcommand === "shape") {
		handleConfigShape();
	}

	if (command === "config" && subcommand === "get") {
		const { config } = parseEnvelope(stdin);
		handleConfigGet(config);
	}

	if (command === "config" && subcommand === "set") {
		handleConfigSet();
	}

	if (command === "tools" && subcommand === "list") {
		handleToolsList();
	}

	if (command === "tools" && subcommand === "execute") {
		if (!stdin.trim()) {
			emitError("tools execute requires JSON on stdin", "invalid_input", 2);
		}
		try {
			const body = JSON.parse(stdin) as JsonRecord;
			await handleToolsExecute(body);
		} catch (error) {
			if (error instanceof SyntaxError) {
				emitError("Invalid JSON on stdin", "invalid_input", 2);
			}
			throw error;
		}
	}

	if (command === "setup" && subcommand === "guide") {
		handleSetupGuide();
	}

	emitError(`Unknown command: ${command ?? "(none)"}`, "usage", 2);
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	emitError(message, "internal_error", 2);
});
