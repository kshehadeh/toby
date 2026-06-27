import {
	clearToolResultCache,
	setCachedToolResult,
} from "@toby/core/chat-pipeline/tool-result-cache";
import * as openUi from "@toby/core/web/open-ui";
import { afterEach, describe, expect, it, jest, mock, spyOn } from "bun:test";

afterEach(() => {
	jest.restoreAllMocks();
});
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
import { statusSlashCommand } from "../src/ui/chat/slash-commands/status";
import { terminalSlashCommand } from "../src/ui/chat/slash-commands/terminal";
import { usageSlashCommand } from "../src/ui/chat/slash-commands/usage";
import { webSlashCommand } from "../src/ui/chat/slash-commands/web";
import * as handoffSpawn from "../src/upgrade/handoff-spawn";
import * as upgradeModule from "../src/upgrade/index";

function mockRuntime(overrides: Record<string, unknown> = {}) {
	return {
		exit: mock(),
		openHelp: mock(),
		openUsageViewer: mock(),
		openLogViewer: mock(),
		openTerminalViewer: mock(),
		openTextViewer: mock(),
		openIntegrationPicker: mock(),
		openConfig: mock(),
		openSkills: mock(),
		openSchedules: mock(),
		openPersonaPicker: mock(),
		openPersonaConfigure: mock(),
		openProjectPicker: mock(),
		openProjectConfigure: mock(),
		startNewSession: mock(),
		openSessionsPicker: mock(),
		chatIntegrationsCount: 0,
		launchContext: captureLaunchContext(["chat"]),
		addMetaLine: mock(),
		addNoticeLine: mock(),
		updateProgressNotice: mock(async () => {}),
		addUserContextMessage: mock(),
		getActivePlan: mock(() => null),
		skipPlanPhase: mock(),
		cancelPlan: mock(),
		restartServer: mock(async () => {}),
		startListenRecording: mock(),
		stopListenRecording: mock(async () => null),
		isListenRecording: mock(() => false),
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
		runtime.addNoticeLine = mock();
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
		const restartServer = mock(async () => {});
		const runtime = mockRuntime({ restartServer });
		await restartServerSlashCommand.run(runtime);
		expect(restartServer).toHaveBeenCalledTimes(1);
	});

	it("opens the web UI after ensuring the daemon is running", async () => {
		const ensureSpy = spyOn(daemonStatus, "ensureDaemonRunning")
			.mockResolvedValue({
				wasAlreadyRunning: true,
				running: true,
				pid: 4242,
			});
		const openSpy = spyOn(openUi, "openWebUiInBrowser")
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
		const openHelp = mock();
		const runtime = mockRuntime({ openHelp });
		helpSlashCommand.run(runtime);
		expect(openHelp).toHaveBeenCalledTimes(1);
	});

	it("opens the usage viewer modal for /usage", () => {
		const openUsageViewer = mock();
		const runtime = mockRuntime({ openUsageViewer });
		usageSlashCommand.run(runtime);
		expect(openUsageViewer).toHaveBeenCalledTimes(1);
	});

	it("includes /usage in slash command list", () => {
		expect(SLASH_COMMANDS.some((c) => c.command === "/usage")).toBe(true);
	});

	it("opens a connections viewer modal for /connect with no args", async () => {
		const addMetaLine = mock();
		const openTextViewer = mock();
		const updateProgressNotice = mock(async () => {});
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
		const addMetaLine = mock();
		const openTextViewer = mock();
		const runtime = mockRuntime({ addMetaLine, openTextViewer });
		await pluginsSlashCommand.run(runtime);
		expect(openTextViewer).toHaveBeenCalledTimes(1);
		expect(openTextViewer.mock.calls[0]?.[0]).toBe("Plugins");
		expect(openTextViewer.mock.calls[0]?.[2]).toEqual({ lineTone: "markdown" });
		const viewerLines = openTextViewer.mock.calls[0]?.[1] as string[];
		expect(
			viewerLines.some((line) => line.includes("## Plugin search paths")),
		).toBe(true);
		expect(addMetaLine).toHaveBeenCalled();
	});

	it("includes /status and opens a status viewer", async () => {
		expect(SLASH_COMMANDS.some((c) => c.command === "/status")).toBe(true);
		const addMetaLine = mock();
		const openTextViewer = mock();
		const runtime = mockRuntime({ addMetaLine, openTextViewer });
		await statusSlashCommand.run(runtime);
		expect(openTextViewer).toHaveBeenCalledTimes(1);
		expect(openTextViewer.mock.calls[0]?.[0]).toBe("Status");
		expect(openTextViewer.mock.calls[0]?.[2]).toEqual({ lineTone: "markdown" });
		const viewerLines = openTextViewer.mock.calls[0]?.[1] as string[];
		expect(viewerLines.some((line) => line.includes("## Version"))).toBe(true);
		expect(viewerLines.some((line) => line.includes("## CLI binary"))).toBe(
			true,
		);
		expect(viewerLines.some((line) => line.includes("## Native app"))).toBe(
			true,
		);
		expect(viewerLines.some((line) => line.includes("## Server"))).toBe(true);
		expect(viewerLines.some((line) => line.includes("## Web UI"))).toBe(true);
		expect(
			viewerLines.some((line) => line.includes("## Plugin directories")),
		).toBe(true);
		expect(
			viewerLines.some((line) => line.includes("## Discovered plugins")),
		).toBe(true);
		expect(viewerLines.some((line) => line.includes("## Helpers"))).toBe(true);
		expect(
			viewerLines.some((line) => line.includes("## Data directories")),
		).toBe(true);
		expect(addMetaLine).toHaveBeenCalled();
	});

	it("opens the log viewer modal for /log", () => {
		const openLogViewer = mock();
		const runtime = mockRuntime({ openLogViewer });
		logSlashCommand.run(runtime);
		expect(openLogViewer).toHaveBeenCalledTimes(1);
	});

	it("opens the terminal viewer modal for /terminal", () => {
		const openTerminalViewer = mock();
		const runtime = mockRuntime({ openTerminalViewer });
		terminalSlashCommand.run(runtime);
		expect(openTerminalViewer).toHaveBeenCalledTimes(1);
	});

	it("includes /persona and opens the picker", () => {
		expect(SLASH_COMMANDS.some((c) => c.command === "/persona")).toBe(true);
		const openPersonaPicker = mock();
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
		const openProjectPicker = mock();
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
		const spawnSpy = spyOn(handoffSpawn, "spawnUpgradeHandoff")
			.mockImplementation(() => undefined);
		const manifestSpy = spyOn(upgradeModule, "readStagingManifest")
			.mockResolvedValue(null);
		const exit = mock();
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
