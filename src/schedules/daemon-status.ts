import fs from "node:fs";
import { ensureTobyDir, resolveTobyDir } from "../config/index";

export function getDaemonLockPath(): string {
	return `${resolveTobyDir()}/daemon.lock`;
}

export function isDaemonRunning(): { running: boolean; pid: number | null } {
	ensureTobyDir();
	const lockPath = getDaemonLockPath();
	if (!fs.existsSync(lockPath)) {
		return { running: false, pid: null };
	}
	const raw = fs.readFileSync(lockPath, "utf-8").trim();
	const pid = Number.parseInt(raw, 10);
	if (Number.isNaN(pid)) {
		return { running: false, pid: null };
	}
	try {
		process.kill(pid, 0);
		return { running: true, pid };
	} catch {
		// Process not running — stale lock file.
		return { running: false, pid: null };
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
