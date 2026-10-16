import "./helpers/setup-mocks";
import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Persona } from "@toby/core/config/index";
import { APICallError } from "ai";
import { generateTextMock, generateTextQueue } from "./helpers/setup-mocks";

const { createGlobalChatTools } = await import(
	"@toby/core/ai/global-chat-tools"
);

const persona: Persona = {
	name: "Test",
	instructions: "",
	promptMode: "add",
	ai: { provider: "openrouter", model: "openai/gpt-5.6-luna" },
};

const skillMarkdown = `---
name: ping-skill
description: Answers with pong.
---

# Ping
Reply with pong.
`;

function providerRejection(): Promise<never> {
	return Promise.reject(
		new APICallError({
			message: "Provider returned error",
			url: "https://openrouter.ai/api/v1/chat/completions",
			requestBodyValues: {},
			statusCode: 400,
			responseHeaders: {},
			responseBody: JSON.stringify({
				error: {
					message: "Provider returned error",
					code: 400,
					metadata: {
						provider_name: "Azure",
						raw: JSON.stringify({
							error: {
								message:
									"Response input messages must contain the word 'json' in some form to use 'text.format' of type 'json_object'.",
							},
						}),
					},
				},
			}),
			isRetryable: false,
		}),
	);
}

describe("createLocalSkill", () => {
	let previousTobyDir: string | undefined;
	let tempDir: string;

	afterEach(() => {
		generateTextQueue.length = 0;
		generateTextMock.mockClear();
		if (previousTobyDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previousTobyDir;
		}
		if (tempDir) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	function useTempTobyDir(): void {
		previousTobyDir = process.env.TOBY_DIR;
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-skill-"));
		process.env.TOBY_DIR = tempDir;
	}

	it("writes the skill from the text fallback when structured output is rejected", async () => {
		useTempTobyDir();
		generateTextQueue.push(providerRejection(), { text: skillMarkdown });
		const tools = createGlobalChatTools({
			dryRun: false,
			persona,
			appliedActions: [],
		});
		const execute = tools.createLocalSkill?.execute as
			| ((input: {
					description: string;
					preferredFolderName?: string;
			  }) => Promise<{ ok: boolean; path?: string; error?: string }>)
			| undefined;

		const result = await execute?.({
			description: "Reply with pong.",
			preferredFolderName: "ping-skill",
		});

		expect(result?.ok).toBe(true);
		expect(generateTextMock).toHaveBeenCalledTimes(2);
		const written = fs.readFileSync(
			path.join(tempDir, "skills", "ping-skill", "SKILL.md"),
			"utf8",
		);
		expect(written).toContain("name: ping-skill");
		expect(written).toContain("Reply with pong.");
	});

	it("includes the upstream provider message when both draft attempts fail", async () => {
		useTempTobyDir();
		generateTextQueue.push(
			providerRejection(),
			Promise.reject(new Error("text failed")),
		);
		const tools = createGlobalChatTools({
			dryRun: false,
			persona,
			appliedActions: [],
		});
		const execute = tools.createLocalSkill?.execute as
			| ((input: {
					description: string;
			  }) => Promise<{ ok: boolean; error?: string }>)
			| undefined;

		const result = await execute?.({ description: "Reply with pong." });

		expect(result?.ok).toBe(false);
		expect(result?.error).toContain(
			"Azure: Response input messages must contain the word 'json'",
		);
		expect(result?.error).toContain("text failed");
		expect(fs.readdirSync(path.join(tempDir, "skills"))).toEqual([]);
	});
});
