import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	getTobyExecPath,
	isRunningAsCompiledBinary,
} from "@toby/core/toby-spawn";

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../../..",
);

export type ResolvedTobyApp = {
	readonly kind: "app-bundle" | "executable";
	readonly path: string;
};

function exists(candidate: string): boolean {
	try {
		return fs.existsSync(candidate);
	} catch {
		return false;
	}
}

function resolveInstallDir(): string {
	return path.dirname(getTobyExecPath());
}

/** Toby.app shipped next to the `toby` binary (release install) or in dist/ (dev). */
export function resolveBundledTobyAppSource(): string | null {
	const candidates = [
		path.join(resolveInstallDir(), "Toby.app"),
		path.join(repoRoot, "dist/Toby.app"),
	];
	for (const candidate of candidates) {
		if (exists(candidate)) {
			return candidate;
		}
	}
	return null;
}

export function resolveTobyAppPath(): ResolvedTobyApp | null {
	const explicit = process.env.TOBY_APP?.trim();
	if (explicit) {
		if (explicit.endsWith(".app")) {
			return { kind: "app-bundle", path: explicit };
		}
		return { kind: "executable", path: explicit };
	}

	const bundled = resolveBundledTobyAppSource();
	const candidates: Array<ResolvedTobyApp> = [
		{ kind: "app-bundle", path: "/Applications/Toby.app" },
		{
			kind: "app-bundle",
			path: path.join(os.homedir(), "Applications/Toby.app"),
		},
		...(bundled ? [{ kind: "app-bundle" as const, path: bundled }] : []),
		{
			kind: "executable",
			path: path.join(repoRoot, "apps/toby-app/.build/release/toby-app"),
		},
	];

	for (const candidate of candidates) {
		if (exists(candidate.path)) {
			return candidate;
		}
	}
	return null;
}

export function launchTobyApp(resolved: ResolvedTobyApp): {
	readonly ok: boolean;
	readonly message: string;
} {
	if (resolved.kind === "app-bundle") {
		const result = spawnSync("open", [resolved.path], { stdio: "ignore" });
		if (result.status === 0) {
			return { ok: true, message: `Launched ${resolved.path}.` };
		}
		return {
			ok: false,
			message: `Failed to launch ${resolved.path}.`,
		};
	}

	const child = spawn(resolved.path, [], {
		detached: true,
		stdio: "ignore",
	});
	child.on("error", () => {
		// Best-effort launch; caller cannot await spawn errors synchronously.
	});
	child.unref();
	return { ok: true, message: `Launched ${resolved.path}.` };
}

export function resolveInstallApplicationsDir(): string {
	try {
		fs.accessSync("/Applications", fs.constants.W_OK);
		return "/Applications";
	} catch {
		return path.join(os.homedir(), "Applications");
	}
}

export function installTobyAppFromDist(): {
	readonly ok: boolean;
	readonly message: string;
	readonly target?: string;
} {
	const source = resolveBundledTobyAppSource();
	if (!source) {
		return {
			ok: false,
			message: isRunningAsCompiledBinary()
				? "Toby.app is not bundled with this install. Re-run the installer after upgrading to a release that includes the native app."
				: "Toby.app is not built. Run `bun run build:app` from the repo, then try again.",
		};
	}
	const installDir = resolveInstallApplicationsDir();
	fs.mkdirSync(installDir, { recursive: true });
	const target = path.join(installDir, "Toby.app");
	fs.rmSync(target, { recursive: true, force: true });
	fs.cpSync(source, target, { recursive: true });
	return {
		ok: true,
		message: `Installed Toby to ${target}.`,
		target,
	};
}

export function buildTobyAppIfNeeded(): {
	readonly ok: boolean;
	readonly message: string;
} {
	const bundled = resolveBundledTobyAppSource();
	if (bundled) {
		return { ok: true, message: "Using bundled Toby.app." };
	}
	const script = path.join(repoRoot, "scripts/build-app.sh");
	if (!exists(script)) {
		return {
			ok: false,
			message: isRunningAsCompiledBinary()
				? "Cannot build Toby.app from an installed release. Re-run the installer after upgrading."
				: "Cannot build Toby.app: scripts/build-app.sh not found.",
		};
	}
	const result = spawnSync("bash", [script], {
		cwd: repoRoot,
		stdio: "pipe",
		encoding: "utf8",
	});
	if (result.status !== 0) {
		return {
			ok: false,
			message:
				result.stderr?.trim() ||
				result.stdout?.trim() ||
				"Failed to build Toby.app.",
		};
	}
	return { ok: true, message: "Built dist/Toby.app." };
}
