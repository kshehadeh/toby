import { spawn } from "node:child_process";
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

function startDaemon(intervalSeconds: number): boolean {
	try {
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

export async function restartDaemonIfRunning(
	defaultIntervalSeconds = 60,
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
	const started = startDaemon(intervalSeconds);
	if (!started) {
		throw new Error("Failed to restart daemon after upgrade.");
	}
	return { wasRunning: true, restarted: true, intervalSeconds };
}
