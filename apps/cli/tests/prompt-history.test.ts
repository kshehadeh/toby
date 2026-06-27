import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	appendPromptHistory,
	loadPromptHistory,
} from "../src/ui/chat/prompt-history";

describe("prompt history store", () => {
	let tmpDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-prompt-history-"));
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = tmpDir;
	});

	afterEach(() => {
		if (previousTobyDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previousTobyDir;
		}
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("persists and dedupes consecutive prompts", () => {
		expect(appendPromptHistory("hello")).toEqual(["hello"]);
		expect(appendPromptHistory("hello")).toEqual(["hello"]);
		expect(appendPromptHistory("world")).toEqual(["hello", "world"]);
		expect(loadPromptHistory()).toEqual(["hello", "world"]);
	});

	it("skips slash commands and blank lines", () => {
		expect(appendPromptHistory("/sessions")).toEqual([]);
		expect(appendPromptHistory("   ")).toEqual([]);
	});
});
