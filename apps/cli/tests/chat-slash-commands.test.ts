import {
	clearToolResultCache,
	setCachedToolResult,
} from "@toby/core/chat-pipeline/tool-result-cache";
import * as openUi from "@toby/core/web/open-ui";
import { describe, expect, it, vi } from "vitest";
import * as daemonStatus from "../src/schedules/daemon-status";
import { captureLaunchContext } from "../src/toby-launch-context";
import {
	SLASH_COMMANDS,
	getNearestSlashCommand,
	resolveSlashSubmission,
} from "../src/ui/chat/slash-commands";
import { connectSlashCommand } from "../src/ui/chat/slash-commands/connect";
import { helpSlashCommand } from "../src/ui/chat/slash-commands/help";
import { logSlashCommand } from "../src/ui/chat/slash-commands/log";
import { pluginsSlashCommand } from "../src/ui/chat/slash-commands/plugins";
import { restartSlashCommand } from "../src/ui/chat/slash-commands/restart";
import { restartServerSlashCommand } from "../src/ui/chat/slash-commands/restart-server";
import { terminalSlashCommand } from "../src/ui/chat/slash-commands/terminal";
import { usageSlashCommand } from "../src/ui/chat/slash-commands/usage";
import { webSlashCommand } from "../src/ui/chat/slash-commands/web";
import * as handoffSpawn from "../src/upgrade/handoff-spawn";
import * as upgradeModule from "../src/upgrade/index";

function mockRuntime(overrides: Record<string, unknown> = {}) {
	return {
		exit: vi.fn(),
		openHelp: vi.fn(),
		openUsageViewer: vi.fn(),
		openLogViewer: vi.fn(),
		openTerminalViewer: vi.fn(),
		openTextViewer: vi.fn(),
		openIntegrationPicker: vi.fn(),
		openConfig: vi.fn(),
		openSkills: vi.fn(),
		openSchedules: vi.fn(),
		openPersonaPicker: vi.fn(),
		openPersonaConfigure: vi.fn(),
		openProjectPicker: vi.fn(),
		openProjectConfigure: vi.fn(),
		startNewSession: vi.fn(),
		openSessionsPicker: vi.fn(),
		chatIntegrationsCount: 0,
		launchContext: captureLaunchContext(["chat"]),
		addMetaLine: vi.fn(),
		addNoticeLine: vi.fn(),
		updateProgressNotice: vi.fn(async () => {}),
		addUserContextMessage: vi.fn(),
		getActivePlan: vi.fn(() => null),
		skipPlanPhase: vi.fn(),
		cancelPlan: vi.fn(),
		restartServer: vi.fn(async () => {}),
		startListenRecording: vi.fn(),
		stopListenRecording: vi.fn(async () => null),
		isListenRecording: vi.fn(() => false),
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

	it("includes /upgrade, /restart, and /restart-server commands", () => {
		expect(SLASH_COMMANDS.some((c) => c.command === "/upgrade")).toBe(true);
		expect(SLASH_COMMANDS.some((c) => c.command === "/restart")).toBe(true);
		expect(SLASH_COMMANDS.some((c) => c.command === "/restart-server")).toBe(
			true,
		);
		expect(SLASH_COMMANDS.some((c) => c.command === "/web")).toBe(true);
		expect(SLASH_COMMANDS.some((c) => c.command === "/start-daemon")).toBe(
			false,
		);
		expect(SLASH_COMMANDS.some((c) => c.command === "/stop-daemon")).toBe(
			false,
		);
	});

	it("delegates /restart-server to runtime.restartServer", async () => {
		const restartServer = vi.fn(async () => {});
		const runtime = mockRuntime({ restartServer });
		await restartServerSlashCommand.run(runtime);
		expect(restartServer).toHaveBeenCalledTimes(1);
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

	it("opens the usage viewer modal for /usage", () => {
		const openUsageViewer = vi.fn();
		const runtime = mockRuntime({ openUsageViewer });
		usageSlashCommand.run(runtime);
		expect(openUsageViewer).toHaveBeenCalledTimes(1);
	});

	it("includes /usage in slash command list", () => {
		expect(SLASH_COMMANDS.some((c) => c.command === "/usage")).toBe(true);
	});

	it("opens a connections viewer modal for /connect with no args", async () => {
		const addMetaLine = vi.fn();
		const openTextViewer = vi.fn();
		const updateProgressNotice = vi.fn(async () => {});
		const runtime = mockRuntime({
			addMetaLine,
			openTextViewer,
			updateProgressNotice,
		});
		await connectSlashCommand.run(runtime);
		expect(updateProgressNotice).toHaveBeenCalled();
		expect(openTextViewer).toHaveBeenCalledTimes(1);
		expect(openTextViewer.mock.calls[0]?.[0]).toBe("Connections");
		expect(openTextViewer.mock.calls[0]?.[2]).toEqual({ lineTone: "markdown" });
		const viewerLines = openTextViewer.mock.calls[0]?.[1] as string[];
		expect(viewerLines.some((line) => line.includes("## Integrations"))).toBe(
			true,
		);
		expect(addMetaLine).toHaveBeenCalled();
	});

	it("does not include /integration in slash command list", () => {
		expect(SLASH_COMMANDS.some((c) => c.command === "/integration")).toBe(
			false,
		);
	});

	it("includes /plugins and opens a plugin status viewer", async () => {
		expect(SLASH_COMMANDS.some((c) => c.command === "/plugins")).toBe(true);
		const addMetaLine = vi.fn();
		const openTextViewer = vi.fn();
		const runtime = mockRuntime({ addMetaLine, openTextViewer });
		await pluginsSlashCommand.run(runtime);
		expect(openTextViewer).toHaveBeenCalledTimes(1);
		expect(openTextViewer.mock.calls[0]?.[0]).toBe("Plugins");
		expect(openTextViewer.mock.calls[0]?.[2]).toEqual({ lineTone: "markdown" });
		const viewerLines = openTextViewer.mock.calls[0]?.[1] as string[];
		expect(
			viewerLines.some((line) => line.includes("## Plugin directory")),
		).toBe(true);
		expect(addMetaLine).toHaveBeenCalled();
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

	it("includes /project and opens the picker", () => {
		expect(SLASH_COMMANDS.some((c) => c.command === "/project")).toBe(true);
		const openProjectPicker = vi.fn();
		const runtime = mockRuntime({ openProjectPicker });
		const result = resolveSlashSubmission("/project", null);
		expect(result.kind).toBe("execute");
		if (result.kind !== "execute" || !result.command) {
			throw new Error("expected execute result");
		}
		result.command.run(runtime);
		expect(openProjectPicker).toHaveBeenCalledTimes(1);
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
