import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { startChatInboundListeners } from "@toby/core/chat-inbound/listeners";
import { getChatInboundStatus } from "@toby/core/chat-inbound/status";
import { readChatInboundConfig } from "@toby/core/config/chat-inbound";
import {
	ensureDefaultPersonaImage,
	ensureTobyDir,
	getDaemonLogPath,
	getWebConfig,
} from "@toby/core/config/index";
import { warmupPluginToolDefinitions } from "@toby/core/integrations/index";
import { startPluginPollingLoop } from "@toby/core/integrations/plugins/poller";
import { pluginDisplayPath } from "@toby/core/integrations/plugins/protocol";
import {
	discoverPluginBinaries,
	resolvePluginSearchDirectories,
} from "@toby/core/integrations/plugins/registry";
import { daemonLog, flushDaemonLogSync } from "@toby/core/logging/daemon-log";
import {
	buildTobySpawnArgs,
	getDetachedDaemonSpawnStdio,
	getTobyExecPath,
} from "@toby/core/toby-spawn";
import { getWebUiUrl, startWebServer } from "@toby/core/web/server";
import chalk from "chalk";
import type { Command } from "commander";
import {
	getDaemonLockPath,
	isDaemonRunning,
	restartDaemon,
	stopDaemon,
} from "../schedules/daemon-status";
import { runSchedulerLoop } from "../schedules/scheduler";

function getWebUiUrlFromConfig(): string | null {
	const { enabled, port } = getWebConfig();
	return enabled ? getWebUiUrl(port) : null;
}

function formatPluginList(): string {
	const plugins = discoverPluginBinaries();
	if (plugins.length === 0) return "  (none found)";
	return plugins
		.map((p) => {
			const name = p.binaryName.replace(/^toby-plugin-/, "");
			return `  ${name} (${p.kind}) — ${pluginDisplayPath(p)}`;
		})
		.join("\n");
}

const DEFAULT_INTERVAL_SECONDS = 60;

function acquireLock(intervalSeconds: number): () => void {
	ensureTobyDir();
	const lockPath = getDaemonLockPath();
	if (fs.existsSync(lockPath)) {
		const raw = fs.readFileSync(lockPath, "utf-8").trim();
		const lockData = (() => {
			const parsedPid = Number.parseInt(raw, 10);
			if (Number.isFinite(parsedPid) && parsedPid > 0) {
				return { pid: parsedPid };
			}
			try {
				const parsed = JSON.parse(raw) as unknown;
				const pidValue = (parsed as { pid?: unknown }).pid;
				if (typeof pidValue === "number" && Number.isFinite(pidValue)) {
					return { pid: pidValue };
				}
			} catch {
				// fall through
			}
			return { pid: Number.NaN };
		})();
		const pid = lockData.pid;
		if (!Number.isNaN(pid)) {
			try {
				process.kill(pid, 0);
				throw new Error(
					`Another daemon is already running (PID ${pid}). Stop it first or remove ${lockPath}.`,
				);
			} catch (e: unknown) {
				if (
					e instanceof Error &&
					e.message.includes("Another daemon is already running")
				) {
					throw e;
				}
				// Process not running — stale lock file, safe to overwrite.
			}
		}
	}
	fs.writeFileSync(
		lockPath,
		JSON.stringify({ pid: process.pid, intervalSeconds }),
	);
	return () => {
		try {
			fs.unlinkSync(lockPath);
		} catch {
			// best effort
		}
	};
}

async function runForegroundDaemon(intervalSeconds: number): Promise<void> {
	let releaseLock: () => void;
	try {
		releaseLock = acquireLock(intervalSeconds);
	} catch (e) {
		console.error(chalk.red(e instanceof Error ? e.message : String(e)));
		process.exitCode = 1;
		return;
	}

	const controller = new AbortController();
	const cleanup = () => {
		daemonLog("info", "daemon", "daemon_stopping", { pid: process.pid });
		controller.abort();
		releaseLock();
		flushDaemonLogSync();
	};

	process.on("SIGINT", () => {
		console.log(chalk.dim("\n[daemon] Stopping…"));
		cleanup();
	});
	process.on("SIGTERM", () => {
		cleanup();
	});

	const intervalMs = intervalSeconds * 1000;
	const inboundCfg = readChatInboundConfig();
	const webCfg = getWebConfig();

	// Warm plugin tool-definition cache so first turn avoids plugin process spawns.
	try {
		warmupPluginToolDefinitions();
	} catch {
		// best-effort; errors are non-fatal
	}

	// Seed default persona image if available
	try {
		const possiblePaths = [
			path.join(process.cwd(), "images", "toby.png"),
			path.join(path.dirname(getTobyExecPath()), "images", "toby.png"),
		];
		for (const p of possiblePaths) {
			if (fs.existsSync(p)) {
				ensureDefaultPersonaImage(p);
				break;
			}
		}
	} catch {
		// best-effort; default image seeding is non-fatal
	}

	daemonLog("info", "daemon", "daemon_started", {
		pid: process.pid,
		intervalSeconds,
		logPath: getDaemonLogPath(),
		pluginDirs: resolvePluginSearchDirectories(),
		chatInboundEnabled: inboundCfg.enabled !== false,
		chatInboundIntegration: inboundCfg.integration ?? null,
		chatInboundPersona: inboundCfg.persona ?? null,
		webEnabled: webCfg.enabled,
		webPort: webCfg.enabled ? webCfg.port : null,
	});
	console.log(
		chalk.cyan(
			`Toby daemon started (schedules every ${intervalSeconds}s, chat inbound if configured).`,
		),
	);
	console.log(chalk.dim(`  Log: ${getDaemonLogPath()}`));
	const pluginDirs = resolvePluginSearchDirectories();
	console.log(chalk.dim(`  Plugins dir: ${pluginDirs.join(", ")}`));
	console.log(chalk.dim("  Discovered plugins:"));
	console.log(chalk.dim(formatPluginList()));
	if (webCfg.enabled) {
		console.log(chalk.dim(`  API: ${getWebUiUrl(webCfg.port)}`));
	}
	console.log(chalk.dim("  Press Ctrl+C to stop."));
	console.log();

	try {
		const tasks: Promise<void>[] = [
			runSchedulerLoop({
				intervalMs,
				signal: controller.signal,
				onCycle: ({ checked, fired }) => {
					if (fired > 0) {
						daemonLog("info", "scheduler", "schedules_fired", {
							checked,
							fired,
						});
						console.log(
							chalk.dim(
								`[daemon] Checked ${checked} schedule(s), fired ${fired}.`,
							),
						);
					}
				},
			}),
			startChatInboundListeners(controller.signal),
			startPluginPollingLoop({
				signal: controller.signal,
				onError: (name, message) => {
					daemonLog("warn", "daemon", "plugin_poll_error", {
						plugin: name,
						message,
					});
				},
			}),
		];
		if (webCfg.enabled) {
			tasks.push(
				startWebServer({ port: webCfg.port, signal: controller.signal }),
			);
		}
		await Promise.all(tasks);
	} catch (error) {
		if (!controller.signal.aborted) {
			const msg = error instanceof Error ? error.message : String(error);
			daemonLog("error", "daemon", "daemon_fatal", { message: msg });
			console.error(chalk.red(`[daemon] Fatal: ${msg}`));
		}
	} finally {
		releaseLock();
		flushDaemonLogSync();
	}
}

function waitForDaemon(
	maxAttempts = 10,
	intervalMs = 300,
): Promise<{ running: boolean; pid: number | null }> {
	return new Promise((resolve) => {
		let attempts = 0;
		const check = () => {
			const result = isDaemonRunning();
			if (result.running) {
				resolve(result);
				return;
			}
			attempts++;
			if (attempts >= maxAttempts) {
				resolve({ running: false, pid: null });
				return;
			}
			setTimeout(check, intervalMs);
		};
		check();
	});
}

export function registerDaemonCommand(program: Command): void {
	const daemon = program
		.command("daemon")
		.description("Manage the schedule daemon");

	daemon
		.command("start")
		.description("Start the daemon as a background process")
		.option(
			"-i, --interval <seconds>",
			`Poll interval in seconds (default ${DEFAULT_INTERVAL_SECONDS})`,
			String(DEFAULT_INTERVAL_SECONDS),
		)
		.action(async (options: { interval?: string }) => {
			const { running, pid } = isDaemonRunning();
			if (running) {
				console.log(chalk.yellow(`Daemon is already running (PID ${pid}).`));
				return;
			}

			const intervalSeconds = Number.parseInt(
				options.interval ?? String(DEFAULT_INTERVAL_SECONDS),
				10,
			);
			if (Number.isNaN(intervalSeconds) || intervalSeconds < 1) {
				console.error(
					chalk.red("Interval must be a positive number of seconds."),
				);
				process.exitCode = 1;
				return;
			}

			const args = buildTobySpawnArgs(
				"daemon",
				"run",
				"--interval",
				String(intervalSeconds),
			);
			const child = spawn(getTobyExecPath(), args, {
				detached: true,
				stdio: getDetachedDaemonSpawnStdio(),
			});
			child.unref();

			console.log(chalk.dim("Starting daemon…"));

			const result = await waitForDaemon();
			if (result.running) {
				console.log(chalk.green(`Daemon started (PID ${result.pid}).`));
				console.log(chalk.dim(`  Log: ${getDaemonLogPath()}`));
				console.log(
					chalk.dim(
						`  Plugins dir: ${resolvePluginSearchDirectories().join(", ")}`,
					),
				);
				console.log(chalk.dim("  Discovered plugins:"));
				console.log(chalk.dim(formatPluginList()));
			} else {
				console.error(
					chalk.red(
						"Daemon process was spawned but did not start within the expected time. Try `toby daemon run` directly.",
					),
				);
				process.exitCode = 1;
			}
		});

	daemon
		.command("stop")
		.description("Stop the running daemon")
		.action(() => {
			const { running, pid } = isDaemonRunning();
			if (!running) {
				console.log(chalk.yellow("Daemon is not running."));
				return;
			}
			const stopped = stopDaemon();
			if (stopped) {
				console.log(chalk.green(`Daemon stopped (was PID ${pid}).`));
			} else {
				console.error(chalk.red("Failed to stop daemon."));
				process.exitCode = 1;
			}
		});

	daemon
		.command("restart")
		.description("Restart the daemon (stop if running, then start)")
		.option(
			"-i, --interval <seconds>",
			`Poll interval in seconds (default: keep current or ${DEFAULT_INTERVAL_SECONDS})`,
		)
		.action(async (options: { interval?: string }) => {
			let intervalSeconds: number | undefined;
			if (options.interval !== undefined) {
				intervalSeconds = Number.parseInt(options.interval, 10);
				if (Number.isNaN(intervalSeconds) || intervalSeconds < 1) {
					console.error(
						chalk.red("Interval must be a positive number of seconds."),
					);
					process.exitCode = 1;
					return;
				}
			}

			try {
				console.log(chalk.dim("Restarting daemon…"));
				const result = await restartDaemon(
					intervalSeconds,
					DEFAULT_INTERVAL_SECONDS,
				);
				if (result.running) {
					const verb = result.wasRunning ? "restarted" : "started";
					console.log(chalk.green(`Daemon ${verb} (PID ${result.pid}).`));
					console.log(
						chalk.dim(`  Schedule poll interval: ${result.intervalSeconds}s`),
					);
					console.log(chalk.dim(`  Log: ${getDaemonLogPath()}`));
					console.log(
						chalk.dim(
							`  Plugins dir: ${resolvePluginSearchDirectories().join(", ")}`,
						),
					);
					console.log(chalk.dim("  Discovered plugins:"));
					console.log(chalk.dim(formatPluginList()));
					const webUrl = getWebUiUrlFromConfig();
					if (webUrl) {
						console.log(chalk.dim(`  API: ${webUrl}`));
					}
				} else {
					console.error(
						chalk.red(
							"Daemon process was spawned but did not start within the expected time. Try `toby daemon run` directly.",
						),
					);
					process.exitCode = 1;
				}
			} catch (e) {
				console.error(chalk.red(e instanceof Error ? e.message : String(e)));
				process.exitCode = 1;
			}
		});

	daemon
		.command("status")
		.description("Show whether the daemon is running")
		.action(() => {
			const { running, pid } = isDaemonRunning();
			if (running) {
				console.log(chalk.green(`Daemon is running (PID ${pid}).`));
			} else {
				console.log(chalk.yellow("Daemon is not running."));
			}
			const inbound = getChatInboundStatus();
			if (inbound.integration) {
				const label =
					inbound.status === "connected"
						? chalk.green(inbound.status)
						: inbound.status === "error"
							? chalk.red(inbound.status)
							: chalk.dim(inbound.status);
				console.log(
					`Chat inbound (${inbound.integration}): ${label}${
						inbound.detail ? chalk.dim(` — ${inbound.detail}`) : ""
					}`,
				);
			} else if (inbound.status !== "disabled") {
				console.log(chalk.dim(`Chat inbound: ${inbound.status}`));
			}
			console.log(chalk.dim(`Daemon log: ${getDaemonLogPath()}`));
			console.log(
				chalk.dim(
					`Plugins dir: ${resolvePluginSearchDirectories().join(", ")}`,
				),
			);
			console.log(chalk.dim("Discovered plugins:"));
			console.log(chalk.dim(formatPluginList()));
			const webUrl = getWebUiUrlFromConfig();
			if (webUrl && running) {
				console.log(chalk.dim(`API: ${webUrl}`));
			}
		});

	daemon
		.command("run")
		.description("Run the daemon in the foreground (used internally)")
		.option(
			"-i, --interval <seconds>",
			`Poll interval in seconds (default ${DEFAULT_INTERVAL_SECONDS})`,
			String(DEFAULT_INTERVAL_SECONDS),
		)
		.action(async (options: { interval?: string }) => {
			const intervalSeconds = Number.parseInt(
				options.interval ?? String(DEFAULT_INTERVAL_SECONDS),
				10,
			);
			if (Number.isNaN(intervalSeconds) || intervalSeconds < 1) {
				console.error(
					chalk.red("Interval must be a positive number of seconds."),
				);
				process.exitCode = 1;
				return;
			}
			await runForegroundDaemon(intervalSeconds);
		});
}
