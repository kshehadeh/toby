import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

export function resolveTobyAppPath(): ResolvedTobyApp | null {
	const explicit = process.env.TOBY_APP?.trim();
	if (explicit) {
		if (explicit.endsWith(".app")) {
			return { kind: "app-bundle", path: explicit };
		}
		return { kind: "executable", path: explicit };
	}

	const candidates: Array<ResolvedTobyApp> = [
		{ kind: "app-bundle", path: "/Applications/Toby.app" },
		{
			kind: "app-bundle",
			path: path.join(os.homedir(), "Applications/Toby.app"),
		},
		{ kind: "app-bundle", path: path.join(repoRoot, "dist/Toby.app") },
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
	const source = path.join(repoRoot, "dist/Toby.app");
	if (!exists(source)) {
		return {
			ok: false,
			message:
				"Toby.app is not built. Run `bun run build:app` or `/install-app` again after building.",
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
	const distApp = path.join(repoRoot, "dist/Toby.app");
	if (exists(distApp)) {
		return { ok: true, message: "Using existing dist/Toby.app." };
	}
	const script = path.join(repoRoot, "scripts/build-app.sh");
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
