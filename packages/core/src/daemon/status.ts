import fs from "node:fs";
import path from "node:path";
import {
	getUnifiedLogPath,
	getWebConfig,
	resolveTobyDir,
} from "../config/index";

export interface DaemonLockData {
	readonly pid: number;
	readonly intervalSeconds: number | null;
}

/** Runtime information about the daemon process serving this request. */
export interface DaemonRuntimeInfo {
	readonly pid: number;
	readonly uptimeSeconds: number;
	readonly startedAt: string;
	readonly intervalSeconds: number | null;
	readonly logPath: string;
	readonly webPort: number | null;
	/** Absolute path of the executable running the daemon (process.argv[1] or execPath). */
	readonly executablePath: string;
}

export function getDaemonLockPath(): string {
	return path.join(resolveTobyDir(), "daemon.lock");
}

export function parseDaemonLock(raw: string): DaemonLockData | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;

	const legacyPid = Number.parseInt(trimmed, 10);
	if (Number.isFinite(legacyPid) && legacyPid > 0) {
		return { pid: legacyPid, intervalSeconds: null };
	}

	try {
		const parsed = JSON.parse(trimmed) as unknown;
		if (!parsed || typeof parsed !== "object") return null;
		const pidValue = (parsed as { pid?: unknown }).pid;
		const intervalValue = (parsed as { intervalSeconds?: unknown })
			.intervalSeconds;
		const pid =
			typeof pidValue === "number" && Number.isFinite(pidValue)
				? pidValue
				: Number.NaN;
		if (!Number.isFinite(pid) || pid <= 0) return null;
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

export function readDaemonLock(): DaemonLockData | null {
	const lockPath = getDaemonLockPath();
	if (!fs.existsSync(lockPath)) return null;
	try {
		return parseDaemonLock(fs.readFileSync(lockPath, "utf-8"));
	} catch {
		return null;
	}
}

/**
 * Runtime info for the daemon process. The web server runs inside the daemon
 * process, so `process.pid` / `process.uptime()` describe the daemon itself.
 */
export function getDaemonRuntimeInfo(): DaemonRuntimeInfo {
	const lock = readDaemonLock();
	const uptimeSeconds = Math.max(0, Math.round(process.uptime()));
	const webCfg = getWebConfig();
	return {
		pid: lock?.pid ?? process.pid,
		uptimeSeconds,
		startedAt: new Date(Date.now() - uptimeSeconds * 1000).toISOString(),
		intervalSeconds: lock?.intervalSeconds ?? null,
		logPath: getUnifiedLogPath(),
		webPort: webCfg.enabled ? webCfg.port : null,
		executablePath: process.argv[1] ?? process.execPath,
	};
}
