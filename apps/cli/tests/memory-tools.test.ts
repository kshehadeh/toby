import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runWithMemoryEmbedTestHooks } from "@toby/core/memory/embeddings";
import * as memory from "@toby/core/memory/memory-service";
import { closeMemoryDbForTests } from "@toby/core/memory/memory-store";
import { createMemoryTools } from "@toby/core/memory/tools";

let previousTobyDir: string | undefined;
let tmpDir: string;

beforeEach(() => {
	previousTobyDir = process.env.TOBY_DIR;
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-memory-tools-"));
	process.env.TOBY_DIR = tmpDir;
});

afterEach(() => {
	closeMemoryDbForTests();
	if (previousTobyDir === undefined) {
		Reflect.deleteProperty(process.env, "TOBY_DIR");
	} else {
		process.env.TOBY_DIR = previousTobyDir;
	}
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const executionOptions = { toolCallId: "memory-test", messages: [] };

describe("chat memory tools", () => {
	for (const example of [
		{
			type: "preference",
			value: "Prefers morning meetings",
			excerpt: "Remember that I prefer morning meetings.",
			autoSaved: true,
		},
		{
			type: "project",
			value: "Main project this quarter is Northstar",
			excerpt: "Save that my main project this quarter is Northstar.",
			autoSaved: false,
		},
		{
			type: "life_event",
			value: "Taking medication for anxiety",
			excerpt: "Remember that I am taking medication for anxiety.",
			autoSaved: false,
		},
	]) {
		it(`stores a requested ${example.type} through propose/save with provenance`, async () => {
			await runWithMemoryEmbedTestHooks(
				{ resolveEmbedder: () => null },
				async () => {
					const appliedActions: string[] = [];
					const tools = createMemoryTools({
						userId: "default",
						dryRun: false,
						appliedActions,
					});
					const proposal = (await tools.memoryPropose?.execute?.(
						{
							type: example.type,
							value: example.value,
							confidence: 1,
							sourceSystem: "chat",
							excerpt: example.excerpt,
							reason: "User asked to remember this information",
						},
						executionOptions,
					)) as { status: string; proposalId: string; message: string };
					expect(proposal.status).toBe(
						example.autoSaved ? "accepted" : "pending",
					);
					if (!example.autoSaved) {
						expect(memory.listMemoryItems("default")).toHaveLength(0);
						expect(proposal.message).toContain("without asking again");
						const saved = await tools.memorySave?.execute?.(
							{ proposalId: proposal.proposalId },
							executionOptions,
						);
						expect(saved).toMatchObject({ ok: true });
					}
					const items = memory.listMemoryItems("default");
					expect(items).toHaveLength(1);
					expect(items[0]?.value).toBe(example.value);
					const explanation = memory.explain("default", items[0]?.id ?? "");
					expect(explanation.sources[0]).toMatchObject({
						system: "chat",
						excerpt: example.excerpt,
					});
					expect(
						explanation.auditTrail.some((entry) => entry.action === "saved"),
					).toBe(true);
					expect(appliedActions).toHaveLength(1);
					if (example.type === "life_event") {
						expect(items[0]?.sensitivity).toBe("restricted");
						expect(items[0]?.visibility).toBe("requires_confirmation");
						expect(memory.listUsableForPrompt("default")).toHaveLength(0);
					}
				},
			);
		});
	}

	it("does not persist a dry-run proposal or claim a failed save succeeded", async () => {
		const appliedActions: string[] = [];
		const tools = createMemoryTools({
			userId: "default",
			dryRun: true,
			appliedActions,
		});
		expect(
			await tools.memoryPropose?.execute?.(
				{
					type: "project",
					value: "Northstar",
					confidence: 1,
					sourceSystem: "chat",
					reason: "User asked to remember it",
				},
				executionOptions,
			),
		).toMatchObject({ dryRun: true });
		expect(
			await tools.memorySave?.execute?.(
				{ proposalId: "missing" },
				executionOptions,
			),
		).toMatchObject({ dryRun: true });
		expect(memory.listMemoryItems("default")).toHaveLength(0);
		const liveTools = createMemoryTools({
			userId: "default",
			dryRun: false,
			appliedActions,
		});
		expect(
			await liveTools.memorySave?.execute?.(
				{ proposalId: "missing" },
				executionOptions,
			),
		).toMatchObject({ ok: false });
		expect(appliedActions).toHaveLength(0);
	});
});
