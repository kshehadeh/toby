import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import { ensureTobyDir, resolveTobyDir } from "@toby/core/config/index";
import {
	buildTobySpawnArgs,
	getDetachedDaemonSpawnStdio,
	getTobyExecPath,
} from "@toby/core/toby-spawn";

export interface DaemonLockData {
	readonly pid: number;
	readonly intervalSeconds: number | null;
}

export function getDaemonLockPath(): string {
	return `${resolveTobyDir()}/daemon.lock`;
}

export function parseDaemonLock(raw: string): DaemonLockData | null {
	const trimmed = raw.trim();
	if (!trimmed) {
		return null;
	}
	const legacyPid = Number.parseInt(trimmed, 10);
	if (Number.isFinite(legacyPid) && legacyPid > 0) {
		return { pid: legacyPid, intervalSeconds: null };
	}
	try {
		const parsed = JSON.parse(trimmed) as unknown;
		if (!parsed || typeof parsed !== "object") {
			return null;
		}
		const pidValue = (parsed as { pid?: unknown }).pid;
		const intervalValue = (parsed as { intervalSeconds?: unknown })
			.intervalSeconds;
		const pid =
			typeof pidValue === "number" && Number.isFinite(pidValue)
				? pidValue
				: Number.NaN;
		if (!Number.isFinite(pid) || pid <= 0) {
			return null;
		}
		const intervalSeconds =
			typeof intervalValue === "number" &&
			Number.isFinite(intervalValue) &&
			intervalValue > 0
				? intervalValue
				: null;
		return { pid, intervalSeconds };
	} catch {
		return null;
	}
}

function readDaemonLock(): DaemonLockData | null {
	ensureTobyDir();
	const lockPath = getDaemonLockPath();
	if (!fs.existsSync(lockPath)) {
		return null;
	}
	const raw = fs.readFileSync(lockPath, "utf-8");
	return parseDaemonLock(raw);
}

export function isDaemonRunning(): {
	running: boolean;
	pid: number | null;
	intervalSeconds: number | null;
} {
	ensureTobyDir();
	const lockData = readDaemonLock();
	if (!lockData) {
		return { running: false, pid: null, intervalSeconds: null };
	}
	try {
		process.kill(lockData.pid, 0);
		return {
			running: true,
			pid: lockData.pid,
			intervalSeconds: lockData.intervalSeconds,
		};
	} catch {
		// Process not running — stale lock file.
		return { running: false, pid: null, intervalSeconds: null };
	}
}

export function stopDaemon(): boolean {
	const { running, pid } = isDaemonRunning();
	if (!running || pid === null) {
		return false;
	}
	try {
		process.kill(pid, "SIGTERM");
		return true;
	} catch {
		return false;
	}
}

/**
 * Find PIDs of processes whose command line contains `pattern`, excluding the
 * current process and any grep/ps invocations.
 */
function findProcessPids(pattern: string): number[] {
	try {
		const output = execSync("ps -eo pid,command", {
			encoding: "utf-8",
			timeout: 5000,
		});
		const pids: number[] = [];
		for (const line of output.split("\n")) {
			if (!line.includes(pattern)) continue;
			if (line.includes("grep") || line.includes("ps -eo")) continue;
			const pid = Number.parseInt(line.trim().split(/\s+/)[0] ?? "", 10);
			if (Number.isFinite(pid) && pid > 1 && pid !== process.pid) {
				pids.push(pid);
			}
		}
		return pids;
	} catch {
		return [];
	}
}

/** Send SIGTERM to each PID and wait up to `maxWaitMs` for them to exit. */
function killPidsAndWait(pids: number[], maxWaitMs = 3000): number {
	let killed = 0;
	for (const pid of pids) {
		try {
			process.kill(pid, "SIGTERM");
			killed++;
		} catch {
			// already exited
		}
	}
	if (killed === 0) return 0;

	const deadline = Date.now() + maxWaitMs;
	for (const pid of pids) {
		while (Date.now() < deadline) {
			try {
				process.kill(pid, 0);
			} catch {
				break; // process exited
			}
			const remaining = deadline - Date.now();
			if (remaining <= 0) break;
			// Busy-wait in small increments (sub-second, no deps)
			const slice = Math.min(100, remaining);
			const start = Date.now();
			while (Date.now() - start < slice) {
				/* spin */
			}
		}
	}
	return killed;
}

/**
 * Kill all stale `daemon run` processes (excluding the current process).
 * Returns the number of processes that were signalled.
 */
export function killStaleDaemonProcesses(): number {
	const pids = findProcessPids("daemon run");
	if (pids.length === 0) return 0;
	return killPidsAndWait(pids);
}

/**
 * Kill all stale inbound plugin processes (e.g. orphaned Slack socket-mode
 * listeners whose parent daemon was killed). Returns the number of processes
 * that were signalled.
 */
export function killStaleInboundProcesses(): number {
	const pids = findProcessPids("inbound run");
	if (pids.length === 0) return 0;
	return killPidsAndWait(pids);
}

/**
 * Start the detached `toby daemon run` process.
 *
 * `execPathOverride` selects the binary to spawn. During a staged upgrade the
 * running process is the (about-to-be-moved) staging binary, so callers must
 * pass the freshly installed binary path; otherwise the staging binary has
 * already been renamed away and the spawn fails with ENOENT.
 */
function startDaemon(
	intervalSeconds: number,
	execPathOverride?: string,
): boolean {
	try {
		const cliArgs = ["daemon", "run", "--interval", String(intervalSeconds)];
		// An explicit override is always a compiled binary, so it must not be
		// prefixed with the entry script that buildTobySpawnArgs adds in dev.
		const execPath = execPathOverride ?? getTobyExecPath();
		const args = execPathOverride ? cliArgs : buildTobySpawnArgs(...cliArgs);
		const child = spawn(execPath, args, {
			detached: true,
			stdio: getDetachedDaemonSpawnStdio(),
		});
		// spawn reports a missing executable via an async "error" event; without
		// a listener that becomes an unhandled error that crashes the process.
		child.on("error", () => undefined);
		child.unref();
		return true;
	} catch {
		return false;
	}
}

async function waitForDaemonStopped(
	pid: number,
	maxWaitMs = 10_000,
	pollIntervalMs = 200,
): Promise<boolean> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < maxWaitMs) {
		try {
			process.kill(pid, 0);
		} catch {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
	}
	return false;
}

async function waitForDaemonRunning(
	maxAttempts = 10,
	intervalMs = 300,
): Promise<{ running: boolean; pid: number | null }> {
	return new Promise((resolve) => {
		let attempts = 0;
		const check = () => {
			const result = isDaemonRunning();
			if (result.running) {
				resolve({ running: true, pid: result.pid });
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

export async function restartDaemon(
	intervalSeconds?: number,
	defaultIntervalSeconds = 60,
): Promise<{
	wasRunning: boolean;
	running: boolean;
	pid: number | null;
	intervalSeconds: number;
}> {
	const status = isDaemonRunning();
	const resolvedInterval =
		intervalSeconds ?? status.intervalSeconds ?? defaultIntervalSeconds;

	if (status.running && status.pid !== null) {
		if (!stopDaemon()) {
			throw new Error("Failed to stop running daemon.");
		}
		const stopped = await waitForDaemonStopped(status.pid);
		if (!stopped) {
			throw new Error("Timed out waiting for daemon to stop.");
		}
	}

	if (!startDaemon(resolvedInterval)) {
		throw new Error("Failed to start daemon.");
	}

	const result = await waitForDaemonRunning();
	return {
		wasRunning: status.running,
		running: result.running,
		pid: result.pid,
		intervalSeconds: resolvedInterval,
	};
}

export async function restartDaemonIfRunning(
	defaultIntervalSeconds = 60,
	execPathOverride?: string,
): Promise<{
	wasRunning: boolean;
	restarted: boolean;
	intervalSeconds: number | null;
}> {
	const status = isDaemonRunning();
	if (!status.running || status.pid === null) {
		return { wasRunning: false, restarted: false, intervalSeconds: null };
	}
	const intervalSeconds = status.intervalSeconds ?? defaultIntervalSeconds;
	if (!stopDaemon()) {
		throw new Error("Failed to stop running daemon before upgrade restart.");
	}
	const stopped = await waitForDaemonStopped(status.pid);
	if (!stopped) {
		throw new Error("Timed out waiting for daemon to stop before restart.");
	}
	const started = startDaemon(intervalSeconds, execPathOverride);
	if (!started) {
		throw new Error("Failed to restart daemon after upgrade.");
	}
	return { wasRunning: true, restarted: true, intervalSeconds };
}

const DEFAULT_DAEMON_INTERVAL_SECONDS = 60;

/** Start the detached daemon if it is not already running. */
export async function ensureDaemonRunning(
	defaultIntervalSeconds = DEFAULT_DAEMON_INTERVAL_SECONDS,
): Promise<{
	wasAlreadyRunning: boolean;
	running: boolean;
	pid: number | null;
}> {
	const status = isDaemonRunning();
	if (status.running) {
		return {
			wasAlreadyRunning: true,
			running: true,
			pid: status.pid,
		};
	}

	const intervalSeconds = status.intervalSeconds ?? defaultIntervalSeconds;
	if (!startDaemon(intervalSeconds)) {
		return { wasAlreadyRunning: false, running: false, pid: null };
	}

	const result = await waitForDaemonRunning();
	return {
		wasAlreadyRunning: false,
		running: result.running,
		pid: result.pid,
	};
}
