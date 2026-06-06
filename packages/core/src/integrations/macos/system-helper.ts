import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getHelpersDir } from "../../config/index";

export interface SystemHelperResult {
	readonly ok: boolean;
	readonly helperVersion?: string;
	readonly data?: Record<string, unknown>;
	readonly error?: string;
	readonly code?: string;
}

export function isMacOSSystemHelperSupported(): boolean {
	return process.platform === "darwin";
}

export function resolveSystemHelperPath(explicitPath?: string): string | null {
	const fromOption = explicitPath?.trim();
	if (fromOption) return fromOption;
	const fromEnv = process.env.TOBY_MACOS_HELPER?.trim();
	if (fromEnv) return fromEnv;
	const executableDir = path.dirname(process.execPath);
	const candidates = [
		path.join(getHelpersDir(), "toby-macos"),
		path.join(executableDir, "toby-macos"),
		path.join(process.cwd(), "dist", "toby-macos"),
		path.join(process.cwd(), "dist", "toby-macos-helper"),
		path.join(
			process.cwd(),
			"helpers",
			"toby-macos-helper",
			".build",
			"release",
			"toby-macos-helper",
		),
		path.join(process.cwd(), "helpers", "toby-macos-helper"),
	];
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) return candidate;
	}
	return null;
}

function requireHelperPath(explicitPath?: string): string {
	const helperPath = resolveSystemHelperPath(explicitPath);
	if (!helperPath) {
		throw new Error(
			"macOS system helper not found. Set TOBY_MACOS_HELPER or build with: bun run build:system-helper",
		);
	}
	if (!fs.existsSync(helperPath)) {
		throw new Error(`macOS system helper does not exist at ${helperPath}.`);
	}
	return helperPath;
}

const DEFAULT_TIMEOUT_MS = 25_000;

export function execSystemHelper(
	domain: string,
	action: string,
	flags: string[] = [],
	options: {
		readonly helperPath?: string;
		readonly timeoutMs?: number;
		readonly input?: string;
	} = {},
): SystemHelperResult {
	if (!isMacOSSystemHelperSupported()) {
		return {
			ok: false,
			error: "macOS system helper requires macOS.",
			code: "unsupported_platform",
		};
	}
	const helperPath = requireHelperPath(options.helperPath);
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	const result = spawnSync(helperPath, [domain, action, ...flags], {
		encoding: "utf8",
		timeout: timeoutMs,
		maxBuffer: 4 * 1024 * 1024,
		input: options.input,
	});

	if (result.error) {
		return {
			ok: false,
			error: result.error.message,
			code: "spawn_error",
		};
	}

	const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
	if (!stdout) {
		return {
			ok: false,
			error: "Helper returned empty output",
			code: "empty_output",
		};
	}

	try {
		const parsed = JSON.parse(stdout) as SystemHelperResult;
		return parsed;
	} catch {
		return {
			ok: false,
			error: `Helper returned non-JSON output: ${stdout.slice(0, 500)}`,
			code: "parse_error",
		};
	}
}

// MARK: - Typed wrapper functions

export interface WifiStatusData {
	interface: string;
	powerOn: boolean;
	ssid?: string;
	bssid?: string;
	rssi?: number;
	channel?: number;
	channelBand?: number;
	security?: number;
}

export function helperWifiStatus(helperPath?: string): WifiStatusData {
	const r = execSystemHelper("wifi", "status", [], { helperPath });
	if (!r.ok || !r.data) throw new Error(r.error ?? "wifi status failed");
	return r.data as unknown as WifiStatusData;
}

export interface WifiScanNetwork {
	ssid: string;
	bssid: string;
	rssi: number;
	channel?: number;
	channelBand?: number;
}

export interface WifiScanData {
	interface: string;
	networks: WifiScanNetwork[];
	count: number;
}

export function helperWifiScan(helperPath?: string): WifiScanData {
	const r = execSystemHelper("wifi", "scan", [], {
		helperPath,
		timeoutMs: 55_000,
	});
	if (!r.ok || !r.data) throw new Error(r.error ?? "wifi scan failed");
	return r.data as unknown as WifiScanData;
}

export function helperWifiPower(
	enabled: boolean,
	helperPath?: string,
): { interface: string; enabled: boolean } {
	const r = execSystemHelper("wifi", "power", [enabled ? "--on" : "--off"], {
		helperPath,
	});
	if (!r.ok || !r.data) throw new Error(r.error ?? "wifi power failed");
	return r.data as unknown as { interface: string; enabled: boolean };
}

export interface AudioDeviceData {
	id: number;
	name: string;
	uid: string;
	isOutput: boolean;
	isInput: boolean;
	isDefaultOutput: boolean;
	isDefaultInput: boolean;
	sampleRate?: number;
}

export interface AudioListData {
	outputs: AudioDeviceData[];
	inputs: AudioDeviceData[];
	defaultOutputId: number;
	defaultInputId: number;
}

export function helperAudioList(helperPath?: string): AudioListData {
	const r = execSystemHelper("audio", "list", [], {
		helperPath,
		timeoutMs: 45_000,
	});
	if (!r.ok || !r.data) throw new Error(r.error ?? "audio list failed");
	return r.data as unknown as AudioListData;
}

export function helperAudioSwitchOutput(
	deviceSubstring: string,
	helperPath?: string,
): { deviceId: number; name: string } {
	const r = execSystemHelper(
		"audio",
		"switch-output",
		["--device", deviceSubstring],
		{ helperPath },
	);
	if (!r.ok || !r.data) throw new Error(r.error ?? "audio switch failed");
	return r.data as unknown as { deviceId: number; name: string };
}

export function helperAudioVolume(helperPath?: string): {
	deviceId: number;
	volume?: number;
	muted?: boolean;
} {
	const r = execSystemHelper("audio", "volume", [], { helperPath });
	if (!r.ok || !r.data) throw new Error(r.error ?? "audio volume failed");
	return r.data as unknown as {
		deviceId: number;
		volume: number;
		muted: boolean;
	};
}

export function helperAudioSetVolume(
	level: number,
	helperPath?: string,
): { level: number; deviceId: number } {
	const r = execSystemHelper(
		"audio",
		"set-volume",
		["--level", String(level)],
		{ helperPath },
	);
	if (!r.ok || !r.data) throw new Error(r.error ?? "audio set-volume failed");
	return r.data as unknown as { level: number; deviceId: number };
}

export function helperAudioSetMute(
	muted: boolean,
	helperPath?: string,
): { muted: boolean; deviceId: number } {
	const r = execSystemHelper("audio", "set-mute", [muted ? "--on" : "--off"], {
		helperPath,
	});
	if (!r.ok || !r.data) throw new Error(r.error ?? "audio set-mute failed");
	return r.data as unknown as { muted: boolean; deviceId: number };
}

export interface BluetoothDeviceData {
	name: string;
	address: string;
	connected: boolean;
	paired: boolean;
}

export interface BluetoothStatusData {
	powerState: string;
	powerStateRaw: number;
	devices: BluetoothDeviceData[];
	deviceCount: number;
}

export function helperBluetoothStatus(
	helperPath?: string,
): BluetoothStatusData {
	const r = execSystemHelper("bluetooth", "status", [], { helperPath });
	if (!r.ok || !r.data) throw new Error(r.error ?? "bluetooth status failed");
	return r.data as unknown as BluetoothStatusData;
}

export function helperBluetoothPower(
	enabled: boolean,
	helperPath?: string,
): { requested: boolean; actual: string; success: boolean } {
	const r = execSystemHelper(
		"bluetooth",
		"power",
		[enabled ? "--on" : "--off"],
		{ helperPath },
	);
	if (!r.ok || !r.data) throw new Error(r.error ?? "bluetooth power failed");
	return r.data as unknown as {
		requested: boolean;
		actual: string;
		success: boolean;
	};
}

export interface BatteryStatusData {
	sourceType: string;
	name: string;
	chargePercent?: number;
	maxCapacity?: number;
	isCharging?: boolean;
	powerSourceState?: string;
	timeToEmptyMinutes?: number;
	timeToFullChargeMinutes?: number;
	isPresent?: boolean;
	cycleCount?: number;
}

export function helperBatteryStatus(helperPath?: string): BatteryStatusData {
	const r = execSystemHelper("battery", "status", [], { helperPath });
	if (!r.ok || !r.data) throw new Error(r.error ?? "battery status failed");
	return r.data as unknown as BatteryStatusData;
}

export interface DisplayBrightnessData {
	displays: Array<{
		displayId?: number;
		isMainDisplay?: boolean;
		brightness: number;
		percent: number;
		source?: string;
	}>;
}

export function helperDisplayBrightness(
	helperPath?: string,
): DisplayBrightnessData {
	const r = execSystemHelper("display", "brightness", [], { helperPath });
	if (!r.ok || !r.data) throw new Error(r.error ?? "display brightness failed");
	return r.data as unknown as DisplayBrightnessData;
}

export function helperDisplaySetBrightness(
	level: number,
	helperPath?: string,
): { level: number } {
	const r = execSystemHelper(
		"display",
		"set-brightness",
		["--level", String(level)],
		{ helperPath },
	);
	if (!r.ok || !r.data)
		throw new Error(r.error ?? "display set-brightness failed");
	return r.data as unknown as { level: number };
}

export function helperLowPowerStatus(helperPath?: string): {
	lowPowerMode: string;
	enabled: boolean;
} {
	const r = execSystemHelper("lowpower", "status", [], { helperPath });
	if (!r.ok || !r.data) throw new Error(r.error ?? "low power status failed");
	return r.data as unknown as { lowPowerMode: string; enabled: boolean };
}

export function helperLowPowerSet(
	enabled: boolean,
	helperPath?: string,
): { lowPowerMode: string; enabled: boolean } {
	const r = execSystemHelper("lowpower", "set", [enabled ? "--on" : "--off"], {
		helperPath,
	});
	if (!r.ok || !r.data) throw new Error(r.error ?? "low power set failed");
	return r.data as unknown as { lowPowerMode: string; enabled: boolean };
}

export function helperShortcutsRun(
	name: string,
	helperPath?: string,
): { shortcutName: string; output: string } {
	const r = execSystemHelper("shortcuts", "run", ["--name", name], {
		helperPath,
		timeoutMs: 120_000,
	});
	if (!r.ok || !r.data) throw new Error(r.error ?? "shortcuts run failed");
	return r.data as unknown as { shortcutName: string; output: string };
}

export interface ClipboardReadData {
	text: string;
	hasContent: boolean;
	types: string[];
}

export function helperClipboardRead(helperPath?: string): ClipboardReadData {
	const r = execSystemHelper("clipboard", "read", [], { helperPath });
	if (!r.ok || !r.data) throw new Error(r.error ?? "clipboard read failed");
	return r.data as unknown as ClipboardReadData;
}

export function helperClipboardWrite(
	text: string,
	helperPath?: string,
): { written: boolean } {
	// Pipe text via stdin to avoid ARG_MAX limits and null-byte truncation in argv
	const r = execSystemHelper("clipboard", "write", ["--stdin"], {
		helperPath,
		input: text,
	});
	if (!r.ok || !r.data) throw new Error(r.error ?? "clipboard write failed");
	return r.data as unknown as { written: boolean };
}

export interface SystemInfoData {
	osVersion: string;
	hardwareModel: string;
	machine: string;
	hostname: string;
	hostName: string;
	uptimeSeconds: number;
	processorCount: number;
	physicalMemoryMB: number;
	osVersionMajor: number;
	osVersionMinor: number;
	osVersionPatch: number;
	osVersionString: string;
	isAppleSilicon: boolean;
}

export function helperSystemInfo(helperPath?: string): SystemInfoData {
	const r = execSystemHelper("system", "info", [], { helperPath });
	if (!r.ok || !r.data) throw new Error(r.error ?? "system info failed");
	return r.data as unknown as SystemInfoData;
}
