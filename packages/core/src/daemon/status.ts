import fs from "node:fs";
import path from "node:path";
import {
	getUnifiedLogPath,
	getWebConfig,
	resolveTobyDir,
} from "../config/index";
import {
	getTobyEntryScriptArgv,
	isRunningAsCompiledBinary,
} from "../toby-spawn";
import { getTobyVersion } from "../version";

export interface DaemonLockData {
	readonly pid: number;
	readonly intervalSeconds: number | null;
}

export type DaemonExecKind = "compiled" | "source";

/** Runtime information about the daemon process serving this request. */
export interface DaemonRuntimeInfo {
	readonly pid: number;
	readonly uptimeSeconds: number;
	readonly startedAt: string;
	readonly intervalSeconds: number | null;
	readonly logPath: string;
	readonly webPort: number | null;
	/** Absolute path of the process binary or entry script running the daemon. */
	readonly executablePath: string;
	/** Whether this process is a compiled binary or a source (bun/node) run. */
	readonly execKind: DaemonExecKind;
	readonly version: string;
	readonly tobyDir: string;
	/** Absolute path of the entry script when running from source; null for compiled. */
	readonly entryScript: string | null;
}

/** Compact identity used for app↔daemon handshake on bootstrap. */
export interface DaemonIdentity {
	readonly version: string;
	readonly executablePath: string;
	readonly execKind: DaemonExecKind;
	readonly tobyDir: string;
	readonly pid: number;
	readonly startedAt: string;
	readonly entryScript: string | null;
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

/** Absolute path of the binary (compiled) or entry script (source) for this process. */
export function resolveDaemonExecutablePath(): string {
	if (isRunningAsCompiledBinary()) {
		return path.resolve(process.execPath);
	}
	const entry = getTobyEntryScriptArgv();
	if (entry) {
		return path.resolve(entry);
	}
	return path.resolve(process.execPath);
}

/**
 * Runtime info for the daemon process. The web server runs inside the daemon
 * process, so `process.pid` / `process.uptime()` describe the daemon itself.
 */
export function getDaemonRuntimeInfo(): DaemonRuntimeInfo {
	const lock = readDaemonLock();
	const uptimeSeconds = Math.max(0, Math.round(process.uptime()));
	const webCfg = getWebConfig();
	const entryScript = getTobyEntryScriptArgv();
	return {
		pid: lock?.pid ?? process.pid,
		uptimeSeconds,
		startedAt: new Date(Date.now() - uptimeSeconds * 1000).toISOString(),
		intervalSeconds: lock?.intervalSeconds ?? null,
		logPath: getUnifiedLogPath(),
		webPort: webCfg.enabled ? webCfg.port : null,
		executablePath: resolveDaemonExecutablePath(),
		execKind: isRunningAsCompiledBinary() ? "compiled" : "source",
		version: getTobyVersion(),
		tobyDir: resolveTobyDir(),
		entryScript: entryScript ? path.resolve(entryScript) : null,
	};
}

/** Identity subset for handshake endpoints (health / bootstrap). */
export function getDaemonIdentity(): DaemonIdentity {
	const runtime = getDaemonRuntimeInfo();
	return {
		version: runtime.version,
		executablePath: runtime.executablePath,
		execKind: runtime.execKind,
		tobyDir: runtime.tobyDir,
		pid: runtime.pid,
		startedAt: runtime.startedAt,
		entryScript: runtime.entryScript,
	};
}
