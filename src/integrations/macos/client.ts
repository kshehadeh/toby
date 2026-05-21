import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readConfig, readCredentials } from "../../config/index";
import {
	type ParsedAirportWifiRow,
	extractBatterySnippet,
	parseAirportScanStdout,
	parseAudioInputDeviceNames,
	parseAudioOutputDeviceNames,
	parseSpAirPortNearbyNetworks,
	parseWifiDeviceFromNetworkSetupList,
} from "./parsers";

const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_STDOUT_CHARS = 120_000;

/**
 * Configure stores macOS plaintext fields under `integrations.macos` in **credentials.json**;
 * `connectedAt` lives in **config.json** after connect. Merge so runtime matches the Ink UI.
 */
function getMergedMacosIntegrationBag(): Record<string, unknown> {
	const fromCfg = readConfig().integrations?.macos ?? {};
	const fromCreds = readCredentials().integrations?.macos ?? {};
	return { ...fromCfg, ...fromCreds };
}

/** True when Toby can drive local macOS system CLIs from this runtime. */
export function isMacOSIntegrationSupported(): boolean {
	return process.platform === "darwin";
}

export interface ExecResult {
	readonly ok: boolean;
	readonly stdout: string;
	readonly stderr: string;
	readonly code: number | null;
}

/** argv[0] is looked up via PATH unless absolute. */
export function execFileUtf8(
	executable: string,
	args: readonly string[],
	options: { readonly timeoutMs?: number } = {},
): ExecResult {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const res = spawnSync(executable, args, {
		encoding: "utf8",
		timeout: timeoutMs,
		maxBuffer: 12 * 1024 * 1024,
	});
	const stdoutRaw = typeof res.stdout === "string" ? res.stdout : "";
	const stderrRaw = typeof res.stderr === "string" ? res.stderr : "";
	const truncate = (s: string) =>
		s.length <= MAX_STDOUT_CHARS
			? s
			: `${s.slice(0, MAX_STDOUT_CHARS)}\n… _(stdout truncated)_`;
	return {
		ok: res.status === 0,
		code: typeof res.status === "number" ? res.status : null,
		stdout: truncate(stdoutRaw),
		stderr: stderrRaw,
	};
}

function networksetup(...args: string[]): ExecResult {
	return execFileUtf8("/usr/sbin/networksetup", [...args]);
}

export function resolvePreferredWifiInterface(): string | null {
	const raw = getMergedMacosIntegrationBag()?.wifiPreferredDevice;
	const preferred =
		typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : "";
	if (preferred && /^en\d+$/.test(preferred) && isMacOSIntegrationSupported()) {
		return preferred;
	}

	const listed = networksetup("-listallhardwareports");
	if (!listed.ok) {
		return null;
	}
	return parseWifiDeviceFromNetworkSetupList(listed.stdout);
}

export function wifiPowerGet(device: string): {
	readonly ok: boolean;
	readonly stdout: string;
	readonly stderr: string;
} {
	const r = networksetup("-getairportpower", device);
	return { ok: r.ok, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}

export function wifiPowerSet(device: string, enabled: boolean): ExecResult {
	const arg = enabled ? "on" : "off";
	return networksetup("-setairportpower", device, arg);
}

/** Apple's hidden `airport` helper ships inside Apple80211.framework (path varies by OS). */
const AIRPORT_CANDIDATES: readonly string[] = [
	"/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport",
	"/System/Library/PrivateFrameworks/Apple80211.framework/Versions/A/Resources/airport",
	"/System/Library/PrivateFrameworks/Apple80211.framework/Resources/airport",
];

export function findAirportUtility(): string | null {
	for (const p of AIRPORT_CANDIDATES) {
		if (existsSync(p)) {
			return p;
		}
	}
	const which = execFileUtf8("/usr/bin/which", ["airport"], {
		timeoutMs: 4000,
	});
	if (which.ok) {
		const p = which.stdout.trim().split("\n")[0]?.trim();
		if (p && existsSync(p)) {
			return p;
		}
	}
	return null;
}

export interface WifiScanNearbyResult {
	readonly ok: boolean;
	readonly device: string | null;
	readonly networks: ParsedAirportWifiRow[];
	readonly rawPreview: string;
	readonly scanSource?: "airport" | "system_profiler";
	readonly error?: string;
}

/** Try `airport -s`; on unreliable output (often Sonoma 14.4+) prefer `system_profiler SPAirPortDataType`. */
export function wifiScanNearby(): WifiScanNearbyResult {
	if (!isMacOSIntegrationSupported()) {
		return {
			ok: false,
			device: null,
			networks: [],
			rawPreview: "",
			error: "Wi‑Fi scans are only available on macOS.",
		};
	}

	const device = resolvePreferredWifiInterface();
	const bin = findAirportUtility();
	const airportTimeoutMs = 30_000;
	const deprecationRe =
		/deprecated|removed|unsupported|goodbye|no longer available|obsolete/i;

	const tryProfiler = (): WifiScanNearbyResult => {
		const sp = execFileUtf8(
			"/usr/sbin/system_profiler",
			["SPAirPortDataType"],
			{ timeoutMs: 55_000 },
		);
		const networks = parseSpAirPortNearbyNetworks(sp.stdout);
		if (sp.ok) {
			return {
				ok: true,
				device,
				networks,
				rawPreview: sp.stdout.slice(0, 8000),
				scanSource: "system_profiler",
			};
		}
		return {
			ok: false,
			device,
			networks,
			rawPreview: sp.stdout.slice(0, 6000),
			scanSource: "system_profiler",
			error:
				sp.stderr.trim() ||
				"system_profiler SPAirPortDataType failed — ensure Wi‑Fi is on.",
		};
	};

	if (!bin) {
		const fb = tryProfiler();
		return fb.ok
			? fb
			: {
					...fb,
					error: `${fb.error ?? "Scan failed"} (no \`airport\` binary on disk or PATH — used SPAirPortDataType instead).`,
				};
	}

	let r = execFileUtf8(bin, ["-s"], { timeoutMs: airportTimeoutMs });
	let networks = parseAirportScanStdout(r.stdout);
	let combinedIo = `${r.stderr}\n${r.stdout}`;
	if ((!r.ok || networks.length === 0) && device) {
		const r2 = execFileUtf8(bin, [device, "scan"], {
			timeoutMs: airportTimeoutMs,
		});
		const n2 = parseAirportScanStdout(r2.stdout);
		combinedIo += `\n${r2.stderr}\n${r2.stdout}`;
		if (n2.length >= networks.length) {
			r = r2;
			networks = n2;
		}
	}

	const deprecationHint = deprecationRe.test(combinedIo);
	if (networks.length > 0 && r.ok && !deprecationHint) {
		return {
			ok: true,
			device,
			networks,
			rawPreview: r.stdout.slice(0, 6000),
			scanSource: "airport",
		};
	}

	const fb = tryProfiler();

	if (!fb.ok) {
		if (networks.length > 0) {
			return {
				ok: true,
				device,
				networks,
				rawPreview: r.stdout.slice(0, 6000),
				scanSource: "airport",
			};
		}
		const parts = [
			r.stderr.trim() || (!r.ok ? `airport exit ${String(r.code)}` : ""),
			fb.error,
		];
		if (deprecationHint) {
			parts.push(
				"`airport` is deprecated/disabled on many Sonoma 14.4+ systems — rely on SPAirPortDataType when healthy.",
			);
		}
		return {
			ok: false,
			device,
			networks: [],
			rawPreview:
				combinedIo.trim().slice(0, 4000) || fb.rawPreview.slice(0, 4000),
			error:
				parts.filter(Boolean).join(" — ") ||
				"Wi‑Fi scan failed — see docs/macos-integration.md.",
		};
	}

	const mergedNetworks =
		fb.networks.length > 0 ? fb.networks : networks.length > 0 ? networks : [];
	const scanSource: WifiScanNearbyResult["scanSource"] =
		fb.networks.length > 0
			? "system_profiler"
			: mergedNetworks.length > 0
				? "airport"
				: "system_profiler";
	const mergedPreview =
		fb.networks.length > 0 && networks.length > 0
			? `${r.stdout.slice(0, 2200)}\n---\n${fb.rawPreview.slice(0, 4000)}`
			: fb.networks.length > 0 || networks.length === 0
				? fb.rawPreview
				: r.stdout.slice(0, 6000);

	return {
		ok: true,
		device,
		networks: mergedNetworks,
		rawPreview: mergedPreview.slice(0, 8000),
		scanSource,
	};
}

export interface BatteryStatusResult {
	readonly ok: boolean;
	readonly pmset: string;
	readonly systemProfilerSnippet: string;
	readonly error?: string;
}

export function getBatteryStatus(): BatteryStatusResult {
	if (!isMacOSIntegrationSupported()) {
		return {
			ok: false,
			pmset: "",
			systemProfilerSnippet: "",
			error: "Battery status is only available on macOS.",
		};
	}
	const pm = execFileUtf8("/usr/bin/pmset", ["-g", "batt"], {
		timeoutMs: 8000,
	});
	const sp = execFileUtf8("/usr/sbin/system_profiler", ["SPBatteryDataType"], {
		timeoutMs: 45_000,
	});
	const ok = pm.ok && sp.ok;
	return {
		ok,
		pmset: pm.stdout.trim(),
		systemProfilerSnippet: extractBatterySnippet(sp.stdout),
		error: ok
			? undefined
			: [
					!pm.ok && pm.stderr.trim() ? `pmset: ${pm.stderr}` : "",
					!sp.ok ? "system_profiler" : "",
				]
					.filter(Boolean)
					.join("; ") ||
				"Incomplete battery snapshot (non-zero exit from pmset/system_profiler)",
	};
}

export function listAudioOutputs(): {
	readonly ok: boolean;
	readonly devices: string[];
	readonly outputs: string[];
	readonly inputs: string[];
	readonly switchAudioSourceDevices?: string[];
	readonly switchAudioSourceOutputs?: string[];
	readonly switchAudioSourceInputs?: string[];
	readonly rawPreview: string;
	readonly error?: string;
} {
	if (!isMacOSIntegrationSupported()) {
		return {
			ok: false,
			devices: [],
			outputs: [],
			inputs: [],
			rawPreview: "",
			error: "Audio listings are only available on macOS.",
		};
	}
	const sp = execFileUtf8("/usr/sbin/system_profiler", ["SPAudioDataType"], {
		timeoutMs: 45_000,
	});
	if (!sp.ok) {
		const switchOutputs = listSwitchAudioSourceDevices("output");
		const switchInputs = listSwitchAudioSourceDevices("input");
		return {
			ok: switchOutputs.length > 0 || switchInputs.length > 0,
			devices: switchOutputs,
			outputs: switchOutputs,
			inputs: switchInputs,
			switchAudioSourceDevices: switchOutputs,
			switchAudioSourceOutputs: switchOutputs,
			switchAudioSourceInputs: switchInputs,
			rawPreview: sp.stdout,
			error:
				switchOutputs.length > 0 || switchInputs.length > 0
					? undefined
					: sp.stderr.trim() || "system_profiler SPAudio failed",
		};
	}
	const switchOutputs = listSwitchAudioSourceDevices("output");
	const switchInputs = listSwitchAudioSourceDevices("input");
	const profilerOutputs = parseAudioOutputDeviceNames(sp.stdout);
	const profilerInputs = parseAudioInputDeviceNames(sp.stdout);
	const outputs = switchOutputs.length > 0 ? switchOutputs : profilerOutputs;
	const inputs = switchInputs.length > 0 ? switchInputs : profilerInputs;
	return {
		ok: true,
		devices: outputs,
		outputs,
		inputs,
		switchAudioSourceDevices:
			switchOutputs.length > 0 ? switchOutputs : undefined,
		switchAudioSourceOutputs:
			switchOutputs.length > 0 ? switchOutputs : undefined,
		switchAudioSourceInputs: switchInputs.length > 0 ? switchInputs : undefined,
		rawPreview: sp.stdout.slice(0, 2000),
	};
}

function listSwitchAudioSourceDevices(type: "input" | "output"): string[] {
	const bin = findSwitchAudioSource();
	if (!bin) return [];
	const r = execFileUtf8(bin, ["-a", "-t", type], { timeoutMs: 8000 });
	if (!r.ok) return [];
	return r.stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

/**
 * Last-resort resolver: login shell inherits the PATH your Terminal.app session uses.
 */
function tryLoginShellWhich(name: string): string | null {
	const quoted = JSON.stringify(name);
	const invocations: ReadonlyArray<readonly [string, readonly string[]]> = [
		["/bin/zsh", ["-il", "-c", `command -v ${quoted}`]],
		["/bin/bash", ["-il", "-c", `command -v ${quoted}`]],
	];
	for (const [shellPath, argv] of invocations) {
		if (!existsSync(shellPath)) continue;
		const res = spawnSync(shellPath, [...argv], {
			encoding: "utf8",
			timeout: 4500,
			env: process.env,
			maxBuffer: 1024,
		});
		if (res.status !== 0 || typeof res.stdout !== "string") {
			continue;
		}
		const hit = res.stdout.trim().split("\n")[0]?.trim();
		if (hit && existsSync(hit)) {
			return hit;
		}
	}
	return null;
}

/**
 * Locate a Homebrew-style CLI (`SwitchAudioSource`, `blueutil`, …) when Toby’s
 * process `PATH` is minimal (Ink UI, Cursor agent, daemon) unlike an interactive terminal.
 */
function findExecutablePreferringHomebrew(name: string): string | null {
	const homebrewBins = ["/opt/homebrew/bin", "/usr/local/bin"];
	for (const dir of homebrewBins) {
		const joined = `${dir}/${name}`;
		if (existsSync(joined)) {
			return joined;
		}
	}
	const enrichedPath = [...homebrewBins, process.env.PATH ?? ""]
		.filter((s) => s.length > 0)
		.join(":");
	const res = spawnSync("/usr/bin/which", [name], {
		encoding: "utf8",
		timeout: 3000,
		env: { ...process.env, PATH: enrichedPath },
		maxBuffer: 1024,
	});
	if (res.status !== 0 || typeof res.stdout !== "string") {
		return tryLoginShellWhich(name);
	}
	const p = res.stdout.trim().split("\n")[0]?.trim();
	return p?.length ? p : tryLoginShellWhich(name);
}

function configurableExecutablePath(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const t = value.trim();
	return t.startsWith("/") && existsSync(t) ? t : null;
}

/** Resolve switchaudio-osx; optional absolute path via Configure overrides discovery. */
export function findSwitchAudioSource(): string | null {
	const bag = getMergedMacosIntegrationBag();
	const pinned = configurableExecutablePath(bag.switchAudioSourcePath);
	if (pinned) return pinned;
	return findExecutablePreferringHomebrew("SwitchAudioSource");
}

export function switchAudioOutput(deviceSubstring: string): ExecResult {
	const bin = findSwitchAudioSource();
	if (!bin) {
		return {
			ok: false,
			code: 127,
			stdout: "",
			stderr:
				"SwitchAudioSource not found. Configure **macos.switchAudioSourcePath** to `/opt/homebrew/bin/SwitchAudioSource` if needed—see docs/macos-integration.md; Toby also probes Homebrew prefixes and login-shell PATH.",
		};
	}
	return execFileUtf8(bin, ["-s", deviceSubstring, "-t", "output"], {
		timeoutMs: 10_000,
	});
}

export function findBlueutil(): string | null {
	return findExecutablePreferringHomebrew("blueutil");
}

export function bluetoothSetPower(enabled: boolean): ExecResult {
	const bin = findBlueutil();
	if (!bin) {
		return {
			ok: false,
			code: 127,
			stdout: "",
			stderr:
				"`blueutil` not found on PATH. Install with `brew install blueutil`, or configure macOS shortcuts (see Toby docs/macos-integration.md).",
		};
	}
	return execFileUtf8(bin, ["--power", enabled ? "1" : "0"], {
		timeoutMs: 8000,
	});
}

export type ShortcutAction =
	| "focusOn"
	| "focusOff"
	| "bluetoothOn"
	| "bluetoothOff"
	| "lowPowerOn"
	| "lowPowerOff";

// Map action -> integration field name on config.integrations.macos
export const SHORTCUT_FIELD_BY_ACTION: Record<ShortcutAction, string> = {
	focusOn: "shortcutFocusOn",
	focusOff: "shortcutFocusOff",
	bluetoothOn: "shortcutBluetoothOn",
	bluetoothOff: "shortcutBluetoothOff",
	lowPowerOn: "shortcutLowPowerOn",
	lowPowerOff: "shortcutLowPowerOff",
};

export function resolveShortcutName(action: ShortcutAction): string | null {
	const cfg = getMergedMacosIntegrationBag();
	const field = SHORTCUT_FIELD_BY_ACTION[action];
	const v = cfg[field];
	if (typeof v !== "string") return null;
	const t = v.trim();
	return t.length ? t : null;
}

export function runShortcut(shortcutName: string): ExecResult {
	if (!shortcutName.trim()) {
		return { ok: false, code: null, stdout: "", stderr: "Shortcut name empty" };
	}
	return execFileUtf8("/usr/bin/shortcuts", ["run", shortcutName.trim()], {
		timeoutMs: 120_000,
	});
}

export function pmsetLowPowerModeGet(): ExecResult {
	return execFileUtf8("/usr/bin/pmset", ["-g", "custom"], { timeoutMs: 8000 });
}

export function pmsetLowPowerModeSet(enabled: boolean): ExecResult {
	const v = enabled ? "1" : "0";
	// Applies to AC + battery-capable setups; may require admin on some macs.
	return execFileUtf8("/usr/bin/pmset", ["-a", "lowpowermode", v], {
		timeoutMs: 8000,
	});
}

export async function smokeTestMacOSSubsystem(): Promise<void> {
	if (!isMacOSIntegrationSupported()) {
		throw new Error("macOS integration requires macOS.");
	}
	const v = execFileUtf8("/usr/bin/sw_vers", ["-productVersion"], {
		timeoutMs: 4000,
	});
	if (!v.ok) {
		throw new Error(`Could not run sw_vers: ${v.stderr || "unknown"}`);
	}
}
