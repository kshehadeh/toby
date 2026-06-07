import { describe, expect, it } from "vitest";
import { routePromptSubmit } from "../src/ui/chat/prompt-submit";
import { pluginsSlashCommand } from "../src/ui/chat/slash-commands/plugins";

describe("routePromptSubmit", () => {
	it("runs slash commands while a turn is active instead of steering", () => {
		const routed = routePromptSubmit("/plugins", null, true);
		expect(routed.kind).toBe("slash");
		if (routed.kind !== "slash") {
			throw new Error("expected slash route");
		}
		expect(routed.resolution.kind).toBe("execute");
		expect(routed.resolution.command).toBe(pluginsSlashCommand);
	});

	it("steers non-slash prompts while a turn is active", () => {
		const routed = routePromptSubmit("check my email", null, true);
		expect(routed).toEqual({ kind: "steering", line: "check my email" });
	});

	it("submits chat prompts when idle", () => {
		const routed = routePromptSubmit("hello", null, false);
		expect(routed).toEqual({ kind: "chat", line: "hello" });
	});
});
