import {
	clearToolResultCache,
	setCachedToolResult,
} from "@toby/core/chat-pipeline/tool-result-cache";
import { describe, expect, it, vi } from "vitest";
import { captureLaunchContext } from "../src/toby-launch-context";
import {
	SLASH_COMMANDS,
	getNearestSlashCommand,
	resolveSlashSubmission,
} from "../src/ui/chat/slash-commands";
import { helpSlashCommand } from "../src/ui/chat/slash-commands/help";
import { logSlashCommand } from "../src/ui/chat/slash-commands/log";
import { terminalSlashCommand } from "../src/ui/chat/slash-commands/terminal";
import { restartSlashCommand } from "../src/ui/chat/slash-commands/restart";
import { webSlashCommand } from "../src/ui/chat/slash-commands/web";
import * as daemonStatus from "../src/schedules/daemon-status";
import * as openUi from "@toby/core/web/open-ui";
import * as handoffSpawn from "../src/upgrade/handoff-spawn";
import * as upgradeModule from "../src/upgrade/index";

function mockRuntime(overrides: Record<string, unknown> = {}) {
	return {
		exit: vi.fn(),
		openHelp: vi.fn(),
		openLogViewer: vi.fn(),
		openTerminalViewer: vi.fn(),
		openIntegrationPicker: vi.fn(),
		openConfig: vi.fn(),
		openSkills: vi.fn(),
		openSchedules: vi.fn(),
		openPersonaPicker: vi.fn(),
		openPersonaConfigure: vi.fn(),
		startNewSession: vi.fn(),
		openSessionsPicker: vi.fn(),
		chatIntegrationsCount: 0,
		launchContext: captureLaunchContext(["chat"]),
		addMetaLine: vi.fn(),
		addNoticeLine: vi.fn(),
		addUserContextMessage: vi.fn(),
		getActivePlan: vi.fn(() => null),
		skipPlanPhase: vi.fn(),
		cancelPlan: vi.fn(),
		...overrides,
	};
}

describe("slash commands", () => {
	it("resolves /clear-tool-cache and clears cached entries", () => {
		clearToolResultCache();
		setCachedToolResult("listLabels", {}, { labels: [{ id: "1" }] });
		const runtime = mockRuntime();
		const result = resolveSlashSubmission("/clear-tool-cache", null);
		expect(result.kind).toBe("execute");
		if (result.kind !== "execute" || !result.command) {
			throw new Error("expected execute result");
		}
		runtime.addNoticeLine = vi.fn();
		result.command.run(runtime);
		expect(runtime.addNoticeLine).toHaveBeenCalledWith(
			"Cleared tool cache (1 entry).",
			"success",
		);
	});

	it("includes clear-tool-cache in slash command list", () => {
		expect(SLASH_COMMANDS.some((c) => c.command === "/clear-tool-cache")).toBe(
			true,
		);
	});

	it("includes /upgrade and /restart commands", () => {
		expect(SLASH_COMMANDS.some((c) => c.command === "/upgrade")).toBe(true);
		expect(SLASH_COMMANDS.some((c) => c.command === "/restart")).toBe(true);
		expect(SLASH_COMMANDS.some((c) => c.command === "/web")).toBe(true);
	});

	it("opens the web UI after ensuring the daemon is running", async () => {
		const ensureSpy = vi
			.spyOn(daemonStatus, "ensureDaemonRunning")
			.mockResolvedValue({
				wasAlreadyRunning: true,
				running: true,
				pid: 4242,
			});
		const openSpy = vi
			.spyOn(openUi, "openWebUiInBrowser")
			.mockResolvedValue(true);
		const runtime = mockRuntime();

		await webSlashCommand.run(runtime);

		expect(ensureSpy).toHaveBeenCalledTimes(1);
		expect(openSpy).toHaveBeenCalledWith("http://127.0.0.1:7847");
		expect(runtime.addNoticeLine).toHaveBeenCalledWith(
			"Opened http://127.0.0.1:7847 in your browser.",
			"success",
		);

		ensureSpy.mockRestore();
		openSpy.mockRestore();
	});

	it("opens the help viewer modal for /help", () => {
		const openHelp = vi.fn();
		const runtime = mockRuntime({ openHelp });
		helpSlashCommand.run(runtime);
		expect(openHelp).toHaveBeenCalledTimes(1);
	});

	it("opens the log viewer modal for /log", () => {
		const openLogViewer = vi.fn();
		const runtime = mockRuntime({ openLogViewer });
		logSlashCommand.run(runtime);
		expect(openLogViewer).toHaveBeenCalledTimes(1);
	});

	it("opens the terminal viewer modal for /terminal", () => {
		const openTerminalViewer = vi.fn();
		const runtime = mockRuntime({ openTerminalViewer });
		terminalSlashCommand.run(runtime);
		expect(openTerminalViewer).toHaveBeenCalledTimes(1);
	});

	it("includes /persona and opens the picker", () => {
		expect(SLASH_COMMANDS.some((c) => c.command === "/persona")).toBe(true);
		const openPersonaPicker = vi.fn();
		const runtime = mockRuntime({ openPersonaPicker });
		const result = resolveSlashSubmission("/persona", null);
		expect(result.kind).toBe("execute");
		if (result.kind !== "execute" || !result.command) {
			throw new Error("expected execute result");
		}
		result.command.run(runtime);
		expect(openPersonaPicker).toHaveBeenCalledTimes(1);
	});

	it("restart exits after spawning handoff", async () => {
		const spawnSpy = vi
			.spyOn(handoffSpawn, "spawnUpgradeHandoff")
			.mockImplementation(() => undefined);
		const manifestSpy = vi
			.spyOn(upgradeModule, "readStagingManifest")
			.mockResolvedValue(null);
		const exit = vi.fn();
		const runtime = mockRuntime({ exit });

		await restartSlashCommand.run(runtime);

		expect(spawnSpy).toHaveBeenCalledTimes(1);
		expect(runtime.addNoticeLine).toHaveBeenCalledWith("Restarting…", "info");
		expect(exit).toHaveBeenCalledTimes(1);

		spawnSpy.mockRestore();
		manifestSpy.mockRestore();
	});

	it("finds the nearest slash command for partial input", () => {
		const match = getNearestSlashCommand("/per");
		expect(match?.command).toBe("/persona");
	});

	it("returns null when there is no slash command match", () => {
		const match = getNearestSlashCommand("/not-a-real-command");
		expect(match).toBeNull();
	});
});
