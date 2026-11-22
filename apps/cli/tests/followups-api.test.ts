import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readConfig, writeConfig } from "@toby/core/config/index";
import { writeGraph } from "@toby/core/graph/write";
import { closeMemoryDbForTests } from "@toby/core/memory/memory-store";
import { closeChatDbForTests } from "@toby/core/session-store";
import {
	handleFollowups,
	handleGraphNeighbors,
} from "@toby/core/web/handlers/followups";
import { handleWebRequest } from "@toby/core/web/routes";

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
let dir = "";

beforeEach(() => {
	dir = path.join(os.tmpdir(), `toby-followups-api-test-${randomUUID()}`);
	fs.mkdirSync(dir, { recursive: true });
	process.env.TOBY_DIR = dir;
	writeConfig({ integrations: {}, personas: [], followups: { enabled: true } });
});

afterEach(() => {
	closeChatDbForTests();
	closeMemoryDbForTests();
	fs.rmSync(dir, { recursive: true, force: true });
	Reflect.deleteProperty(process.env, "TOBY_DIR");
});

describe.skipIf(!isBun)("follow-up HTTP handlers", () => {
	it("routes settings, manual runs, graph inspection, and rebuild through the daemon entry point", async () => {
		const response = await handleWebRequest(
			new Request("http://localhost/api/followups/config", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ followups: { enabled: false } }),
			}),
		);
		expect(response.status).toBe(200);
		const run = await handleWebRequest(
			new Request("http://localhost/api/followups/run", { method: "POST" }),
		);
		expect(await run.json()).toMatchObject({
			status: "disabled",
			evaluated: 0,
		});
		const [id] = writeGraph({
			nodes: [{ type: "topic", key: "route-test", label: "Route test" }],
		}).nodeIds;
		const graph = await handleWebRequest(
			new Request(`http://localhost/api/graph/nodes/${id}/neighbors`),
		);
		expect(graph.status).toBe(200);
		expect(await graph.json()).toMatchObject({ node: { id }, neighbors: [] });
		expect(
			(
				await handleWebRequest(
					new Request("http://localhost/api/graph/rebuild", { method: "POST" }),
				)
			).status,
		).toBe(200);
	});

	it("patches nested settings without losing other overrides", async () => {
		writeConfig({
			integrations: {},
			personas: [],
			followups: {
				sources: { calendar: false },
				thresholds: { close: 0.95 },
				kinds: { commitment: false },
			},
		});
		const req = new Request("http://localhost/api/followups/config", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				followups: {
					sources: { memory: false },
					thresholds: { open: 0.8 },
					kinds: { oweReply: false },
				},
			}),
		});
		expect((await handleFollowups(req, new URL(req.url))).status).toBe(200);
		expect(readConfig().followups).toEqual({
			sources: { calendar: false, memory: false },
			thresholds: { close: 0.95, open: 0.8 },
			kinds: { commitment: false, oweReply: false },
		});
	});

	it("lists follow-up loops and lets users clear an explicit evaluator", async () => {
		writeConfig({
			integrations: {},
			personas: [],
			followups: {
				enabled: true,
				evaluator: { provider: "openai", model: "gpt-test" },
			},
		});
		const list = await handleFollowups(
			new Request("http://localhost/api/followups"),
			new URL("http://localhost/api/followups"),
		);
		expect(list.status).toBe(200);
		expect(await list.json()).toEqual({ loops: [] });

		const request = new Request("http://localhost/api/followups/config", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				followups: { evaluator: { provider: null, model: null } },
			}),
		});
		const response = await handleFollowups(request, new URL(request.url));
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			followups: { evaluator?: Record<string, unknown> };
		};
		expect(body.followups.evaluator).toBeUndefined();
	});

	it("persists only non-default follow-up and graph settings", async () => {
		const request = new Request("http://localhost/api/followups/config", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				followups: {
					enabled: true,
					sources: { calendar: false, memory: true },
					kinds: { oweReply: false, awaitingReply: true },
					awaitingReplyDays: 3,
					thresholds: { open: 0.75, close: 0.9 },
					autoComplete: true,
					notifications: true,
					intervalMinutes: 30,
					maxEvaluationsPerDay: 200,
				},
				graph: { semanticThreshold: 0.8, maxExtractionsPerDay: 300 },
			}),
		});
		const response = await handleFollowups(request, new URL(request.url));
		expect(response.status).toBe(200);
		expect(readConfig().followups).toEqual({
			sources: { calendar: false },
			kinds: { oweReply: false },
			thresholds: { close: 0.9 },
		});
		expect(readConfig().graph).toBeUndefined();
	});

	it("returns default-enabled metadata for available sources", async () => {
		const url = new URL("http://localhost/api/followups/sources");
		const response = await handleFollowups(new Request(url), url);
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			sources: Array<{ id: string; defaultEnabled: boolean }>;
		};
		expect(
			body.sources.find((source) => source.id === "calendar")?.defaultEnabled,
		).toBe(true);
		expect(
			body.sources.find((source) => source.id === "memory")?.defaultEnabled,
		).toBe(true);
	});

	it("creates, updates, lists, and deletes follow-up instructions", async () => {
		const createUrl = new URL("http://localhost/api/followups/instructions");
		const created = await handleFollowups(
			new Request(createUrl, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "Prioritize direct requests" }),
			}),
			createUrl,
		);
		expect(created.status).toBe(201);
		const createdBody = (await created.json()) as {
			instruction: { id: string };
			instructions: Array<{ text: string }>;
		};
		expect(createdBody.instructions.map((item) => item.text)).toEqual([
			"Prioritize direct requests",
		]);

		const instructionUrl = new URL(
			`${createUrl}/${createdBody.instruction.id}`,
		);
		const updated = await handleFollowups(
			new Request(instructionUrl, {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: "Prioritize explicit commitments" }),
			}),
			instructionUrl,
		);
		expect(
			((await updated.json()) as { instructions: Array<{ text: string }> })
				.instructions[0]?.text,
		).toBe("Prioritize explicit commitments");

		const deleted = await handleFollowups(
			new Request(instructionUrl, { method: "DELETE" }),
			instructionUrl,
		);
		expect(
			((await deleted.json()) as { instructions: unknown[] }).instructions,
		).toEqual([]);
	});

	it("does not expose private memories through graph-neighbor inspection", async () => {
		const [nodeId] = writeGraph({
			nodes: [
				{
					type: "memory",
					key: "private-secret",
					label: "Private memory",
					visibility: "private",
					props: { secret: "hidden" },
				},
			],
		}).nodeIds;
		if (!nodeId) throw new Error("Expected private graph node");
		const url = new URL(`http://localhost/api/graph/nodes/${nodeId}/neighbors`);
		const response = await handleGraphNeighbors(new Request(url), nodeId, url);
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: "Graph node not found" });
	});
});
