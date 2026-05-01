import { describe, expect, it, vi } from "vitest";
import {
	clearToolResultCache,
	setCachedToolResult,
} from "../src/chat-pipeline/tool-result-cache";
import {
	SLASH_COMMANDS,
	resolveSlashSubmission,
} from "../src/ui/chat/slash-commands";

describe("slash commands", () => {
	it("resolves /clear-tool-cache and clears cached entries", () => {
		clearToolResultCache();
		setCachedToolResult("listLabels", {}, { labels: [{ id: "1" }] });
		const addMetaLine = vi.fn();
		const result = resolveSlashSubmission("/clear-tool-cache", null);
		expect(result.kind).toBe("execute");
		if (result.kind !== "execute" || !result.command) {
			throw new Error("expected execute result");
		}
		result.command.run({
			exit: vi.fn(),
			openHelp: vi.fn(),
			openIntegrationPicker: vi.fn(),
			openConfig: vi.fn(),
			openPersonaPicker: vi.fn(),
			openPersonaConfigure: vi.fn(),
			startNewSession: vi.fn(),
			openSessionsPicker: vi.fn(),
			chatIntegrationsCount: 0,
			addMetaLine,
		});
		expect(addMetaLine).toHaveBeenCalledWith("Cleared tool cache (1 entry).");
	});

	it("includes clear-tool-cache in slash command list", () => {
		expect(SLASH_COMMANDS.some((c) => c.command === "/clear-tool-cache")).toBe(
			true,
		);
	});

	it("includes /persona and opens the picker", () => {
		expect(SLASH_COMMANDS.some((c) => c.command === "/persona")).toBe(true);
		const openPersonaPicker = vi.fn();
		const result = resolveSlashSubmission("/persona", null);
		expect(result.kind).toBe("execute");
		if (result.kind !== "execute" || !result.command) {
			throw new Error("expected execute result");
		}
		result.command.run({
			exit: vi.fn(),
			openHelp: vi.fn(),
			openIntegrationPicker: vi.fn(),
			openConfig: vi.fn(),
			openPersonaPicker,
			openPersonaConfigure: vi.fn(),
			startNewSession: vi.fn(),
			openSessionsPicker: vi.fn(),
			chatIntegrationsCount: 0,
			addMetaLine: vi.fn(),
		});
		expect(openPersonaPicker).toHaveBeenCalledTimes(1);
	});
});
