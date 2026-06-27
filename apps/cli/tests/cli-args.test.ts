import { describe, expect, it } from "bun:test";
import { normalizeRootCliArgs } from "../src/cli-args";

describe("normalizeRootCliArgs", () => {
	it("defaults bare toby to chat", () => {
		expect(normalizeRootCliArgs([])).toEqual(["chat"]);
	});

	it("maps root -p to chat --prompt", () => {
		expect(normalizeRootCliArgs(["-p", "summarize inbox"])).toEqual([
			"chat",
			"--prompt",
			"summarize inbox",
		]);
	});

	it("maps root --prompt to chat --prompt", () => {
		expect(normalizeRootCliArgs(["--prompt", "hello"])).toEqual([
			"chat",
			"--prompt",
			"hello",
		]);
	});

	it("defaults root chat flags to chat", () => {
		expect(normalizeRootCliArgs(["--debug"])).toEqual(["chat", "--debug"]);
		expect(normalizeRootCliArgs(["--no-tui", "quick question"])).toEqual([
			"chat",
			"--no-tui",
			"quick question",
		]);
	});

	it("preserves root help and version flags", () => {
		expect(normalizeRootCliArgs(["--help"])).toEqual(["--help"]);
		expect(normalizeRootCliArgs(["-h"])).toEqual(["-h"]);
		expect(normalizeRootCliArgs(["--version"])).toEqual(["--version"]);
	});

	it("preserves explicit subcommands", () => {
		expect(normalizeRootCliArgs(["status"])).toEqual(["status"]);
		expect(normalizeRootCliArgs(["chat", "hello"])).toEqual(["chat", "hello"]);
		expect(normalizeRootCliArgs(["listen", "--mic-only"])).toEqual([
			"listen",
			"--mic-only",
		]);
	});

	it("does not treat unknown positional tokens as chat prompts", () => {
		expect(normalizeRootCliArgs(["staatus"])).toEqual(["staatus"]);
		expect(normalizeRootCliArgs(["summarize", "inbox"])).toEqual([
			"summarize",
			"inbox",
		]);
		expect(normalizeRootCliArgs(["hello", "world"])).toEqual([
			"hello",
			"world",
		]);
	});
});
