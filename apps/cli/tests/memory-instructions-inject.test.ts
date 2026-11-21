import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CoreMessage } from "@toby/core/ai/chat";
import { globalChatToolsPromptSection } from "@toby/core/ai/global-chat-tools";
import { MEMORY_POLICY } from "@toby/core/memory/instructions";
import * as memory from "@toby/core/memory/memory-service";
import { closeMemoryDbForTests } from "@toby/core/memory/memory-store";
import { MEMORY_INSTRUCTIONS_APPENDIX_START } from "@toby/core/memory/prompt";
import {
	injectMemoriesIntoFirstSystemMessage,
	injectMemoryPolicy,
	stripMemoryInstructionsAppendix,
} from "@toby/core/prepare-messages";

const isBun =
	typeof (globalThis as unknown as { Bun?: unknown }).Bun !== "undefined";

const TMP_DIR = path.join(
	os.tmpdir(),
	`toby-memory-inject-test-${randomUUID()}`,
);

beforeEach(() => {
	fs.mkdirSync(TMP_DIR, { recursive: true });
	process.env.TOBY_DIR = TMP_DIR;
});

afterEach(() => {
	closeMemoryDbForTests();
	try {
		fs.rmSync(TMP_DIR, { recursive: true, force: true });
	} catch {
		// ignore
	}
	Reflect.deleteProperty(process.env, "TOBY_DIR");
});

describe.skipIf(!isBun)("injectMemoriesIntoFirstSystemMessage", () => {
	it("injects saving instructions into existing and integration-only sessions without memories", () => {
		const messages: CoreMessage[] = [
			{ role: "system", content: "Integration-only instructions." },
			{ role: "user", content: "Remember my project is Northstar." },
		];
		const out = injectMemoryPolicy(messages);
		expect(out[0]?.content).toContain(MEMORY_POLICY);
		expect(out[0]?.content).toContain("Do not ask for confirmation again.");
		expect(out[0]?.content).toContain("immediately call **memorySave**");
		expect(out[0]?.content).toContain("Inferred sensitive or restricted");
		expect(out[1]).toEqual(messages[1]);
		expect(messages[0]?.content).toBe("Integration-only instructions.");
		expect(injectMemoryPolicy(out)).toEqual(out);
	});

	it("does not duplicate memory policy in combined chat instructions", () => {
		const messages: CoreMessage[] = [
			{ role: "system", content: globalChatToolsPromptSection() },
		];
		expect(injectMemoryPolicy(messages)).toEqual(messages);
		expect(messages[0]?.content).toContain(MEMORY_POLICY);
	});

	it("leaves empty and non-system messages unchanged", () => {
		expect(injectMemoryPolicy([])).toEqual([]);
		const messages: CoreMessage[] = [{ role: "user", content: "Hello" }];
		expect(injectMemoryPolicy(messages)).toEqual(messages);
	});

	it("appends usable memories to the first system message", async () => {
		await memory.createManual("default", {
			value: "Lives in Baltimore, Maryland",
		});
		await memory.createManual("default", {
			value: "Hidden address",
			visibility: "requires_confirmation",
		});
		await memory.createManual("default", {
			value: "Private note",
			visibility: "private",
		});

		const messages: CoreMessage[] = [
			{ role: "system", content: "Base system." },
			{ role: "user", content: "Where do I live?" },
		];
		const out = injectMemoriesIntoFirstSystemMessage(messages);
		const content = out[0]?.content as string;
		expect(content.startsWith("Base system.")).toBe(true);
		expect(content).toContain(MEMORY_INSTRUCTIONS_APPENDIX_START);
		expect(content).toContain("Lives in Baltimore, Maryland");
		expect(content).not.toContain("Hidden address");
		expect(content).not.toContain("Private note");
	});

	it("replaces a prior memories appendix", async () => {
		await memory.createManual("default", {
			value: "My name is Karim Shehadeh",
		});
		const messages: CoreMessage[] = [
			{
				role: "system",
				content: `Base.${MEMORY_INSTRUCTIONS_APPENDIX_START}old body`,
			},
		];
		const out = injectMemoriesIntoFirstSystemMessage(messages);
		const content = out[0]?.content as string;
		expect(content).toContain("My name is Karim Shehadeh");
		expect(content).not.toContain("old body");
		expect((content.match(/Known memories/g) ?? []).length).toBe(1);
	});

	it("strips a prior appendix when nothing is usable", async () => {
		await memory.createManual("default", {
			value: "restricted",
			visibility: "private",
		});
		const messages: CoreMessage[] = [
			{
				role: "system",
				content: `Base.${MEMORY_INSTRUCTIONS_APPENDIX_START}old body`,
			},
		];
		const out = injectMemoriesIntoFirstSystemMessage(messages);
		expect(out[0]?.content).toBe("Base.");
		expect(stripMemoryInstructionsAppendix("Base.")).toBe("Base.");
	});
});
