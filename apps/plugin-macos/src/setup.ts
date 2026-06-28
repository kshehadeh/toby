import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nativeRequest } from "./native-client";

type JsonRecord = Record<string, unknown>;

type BundledShortcutEntry = {
	file: string;
	name: string;
	description: string;
};

type BundledShortcutsManifest = {
	shortcuts: BundledShortcutEntry[];
};

function pluginDir(): string {
	const entry = process.argv[1] ?? "";
	return path.resolve(path.dirname(entry), "..");
}

function bundledShortcutsDir(): string {
	return path.join(pluginDir(), "BundledShortcuts");
}

function tobyDir(): string {
	const override = process.env.TOBY_DIR;
	if (override?.trim()) {
		return path.resolve(override.replace(/^~(?=$|\/|\\)/, os.homedir()));
	}
	return path.join(os.homedir(), ".toby");
}

function stateFilePath(): string {
	return path.join(tobyDir(), "plugin-macos-setup-state.json");
}

function loadPreviouslyOpenedShortcuts(): Set<string> {
	try {
		const raw = fs.readFileSync(stateFilePath(), "utf8");
		const json = JSON.parse(raw) as { openedShortcuts?: string[] };
		return new Set(json.openedShortcuts ?? []);
	} catch {
		return new Set();
	}
}

function savePreviouslyOpenedShortcuts(names: Set<string>): void {
	try {
		const dir = tobyDir();
		fs.mkdirSync(dir, { recursive: true });
		const json = { openedShortcuts: Array.from(names).sort() };
		fs.writeFileSync(stateFilePath(), JSON.stringify(json), "utf8");
	} catch {
		// Best-effort persistence
	}
}

function listInstalledShortcutNames(): Set<string> {
	const result = spawnSync("/usr/bin/shortcuts", ["list"], {
		encoding: "utf8",
		timeout: 15_000,
	});
	if (result.status !== 0 || result.error) {
		throw new Error("shortcuts list failed");
	}
	const lines = (result.stdout ?? "")
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
	return new Set(lines);
}

function isShortcutInstalled(name: string, installed: Set<string>): boolean {
	const target = name.trim().toLowerCase();
	for (const entry of installed) {
		if (entry.trim().toLowerCase() === target) return true;
	}
	return false;
}

function shortcutActionId(name: string): string {
	return `shortcut:${name
		.toLowerCase()
		.replace(/ /g, "-")
		.replace(/[^a-z0-9-]/g, "")}`;
}

function openBundledShortcutImport(entry: BundledShortcutEntry): void {
	const shortcutPath = path.join(bundledShortcutsDir(), entry.file);
	if (!fs.existsSync(shortcutPath)) {
		throw new Error(`Bundled shortcut file is missing: ${entry.file}`);
	}
	const result = spawnSync("/usr/bin/open", ["-g", shortcutPath], {
		encoding: "utf8",
	});
	if (result.status !== 0 || result.error) {
		throw new Error(`Failed to open shortcut import for ${entry.name}.`);
	}
}

function loadManifest(): BundledShortcutsManifest {
	const manifestPath = path.join(bundledShortcutsDir(), "manifest.json");
	const raw = fs.readFileSync(manifestPath, "utf8");
	return JSON.parse(raw) as BundledShortcutsManifest;
}

function accessibilityAction(): JsonRecord {
	const actionId = "accessibility-permission";
	const label =
		"Grant Accessibility permission for window minimize and unminimize";
	const r = nativeRequest("macos/accessibility-status");
	if (r.ok && r.data?.accessibilityGranted === true) {
		return {
			id: actionId,
			label,
			ok: true,
			skipped: true,
			detail: "Accessibility permission is already granted for Toby.app.",
		};
	}
	return {
		id: actionId,
		label,
		ok: true,
		detail:
			"Accessibility permission is needed for window minimize/unminimize. Grant access to Toby.app in System Settings → Privacy & Security → Accessibility, then re-run setup.",
	};
}

export function runSetup(): JsonRecord[] {
	const manifest = loadManifest();
	const installed = listInstalledShortcutNames();
	const previouslyOpened = loadPreviouslyOpenedShortcuts();
	const actions: JsonRecord[] = [];

	for (const entry of manifest.shortcuts) {
		const actionId = shortcutActionId(entry.name);
		const label = `Install ${entry.name} shortcut`;

		if (isShortcutInstalled(entry.name, installed)) {
			actions.push({
				id: actionId,
				label,
				ok: true,
				skipped: true,
				detail: "Shortcut already installed.",
			});
			continue;
		}

		if (previouslyOpened.has(entry.name)) {
			actions.push({
				id: actionId,
				label,
				ok: true,
				skipped: true,
				detail:
					"Shortcut import was already opened in a previous setup run. If you still need to add it, open Shortcuts.app manually.",
			});
			continue;
		}

		try {
			openBundledShortcutImport(entry);
			previouslyOpened.add(entry.name);
			savePreviouslyOpenedShortcuts(previouslyOpened);
			actions.push({
				id: actionId,
				label,
				ok: true,
				detail: "Opened Shortcuts import — tap Add Shortcut to finish.",
			});
		} catch (error) {
			actions.push({
				id: actionId,
				label,
				ok: false,
				detail: error instanceof Error ? error.message : String(error),
			});
		}
	}

	actions.push(accessibilityAction());
	return actions;
}
