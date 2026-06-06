import {
	type AudioDeviceData,
	type BatteryStatusData,
	type BluetoothStatusData,
	type ClipboardReadData,
	type DisplayBrightnessData,
	type SystemInfoData,
	type WifiScanData,
	type WifiStatusData,
	helperAudioList,
	helperAudioSetMute,
	helperAudioSetVolume,
	helperAudioSwitchOutput,
	helperAudioVolume,
	helperBatteryStatus,
	helperBluetoothPower,
	helperBluetoothStatus,
	helperClipboardRead,
	helperClipboardWrite,
	helperDisplayBrightness,
	helperDisplaySetBrightness,
	helperLowPowerSet,
	helperLowPowerStatus,
	helperShortcutsRun,
	helperSystemInfo,
	helperWifiPower,
	helperWifiScan,
	helperWifiStatus,
	isMacOSSystemHelperSupported,
} from "./system-helper";

export function isMacOSIntegrationSupported(): boolean {
	return isMacOSSystemHelperSupported();
}

export function resolvePreferredWifiInterface(): string | null {
	try {
		const status = helperWifiStatus();
		return status.interface || null;
	} catch {
		return null;
	}
}

export function wifiPowerGet(device: string): {
	readonly ok: boolean;
	readonly stdout: string;
	readonly stderr: string;
} {
	try {
		const status = helperWifiStatus();
		return {
			ok: true,
			stdout: status.powerOn ? "Power: On" : "Power: Off",
			stderr: "",
		};
	} catch (e) {
		return { ok: false, stdout: "", stderr: (e as Error).message };
	}
}

export function wifiPowerSet(
	device: string,
	enabled: boolean,
): { ok: boolean; stdout: string; stderr: string; code: number | null } {
	try {
		helperWifiPower(enabled);
		return { ok: true, stdout: "OK", stderr: "", code: 0 };
	} catch (e) {
		return { ok: false, stdout: "", stderr: (e as Error).message, code: 1 };
	}
}

export interface WifiScanNearbyResult {
	readonly ok: boolean;
	readonly device: string | null;
	readonly networks: Array<{ ssid: string; bssid: string; rssi: number }>;
	readonly rawPreview: string;
	readonly scanSource?: "corewlan";
	readonly error?: string;
}

export function wifiScanNearby(): WifiScanNearbyResult {
	if (!isMacOSIntegrationSupported()) {
		return {
			ok: false,
			device: null,
			networks: [],
			rawPreview: "",
			error: "Wi-Fi scans are only available on macOS.",
		};
	}
	try {
		const data = helperWifiScan();
		const networks = data.networks.map((n) => ({
			ssid: n.ssid,
			bssid: n.bssid,
			rssi: n.rssi,
		}));
		return {
			ok: true,
			device: data.interface,
			networks,
			rawPreview: JSON.stringify(data).slice(0, 8000),
			scanSource: "corewlan",
		};
	} catch (e) {
		return {
			ok: false,
			device: null,
			networks: [],
			rawPreview: "",
			error: (e as Error).message,
		};
	}
}

export function getBatteryStatus(): {
	ok: boolean;
	pmset: string;
	systemProfilerSnippet: string;
	error?: string;
} {
	try {
		const data = helperBatteryStatus();
		const pmset = [
			data.powerSourceState === "AC Power" ? "AC Power" : "Battery Power",
			data.isCharging ? "Charging" : "Not Charging",
			`${data.chargePercent ?? 0}%`,
		].join("; ");
		const snippet = [
			`Condition: ${data.sourceType}`,
			`Charge: ${data.chargePercent ?? 0}%`,
			`Cycles: ${data.cycleCount ?? "unknown"}`,
			`Max Capacity: ${data.maxCapacity ?? "unknown"}%`,
		].join("\n");
		return { ok: true, pmset, systemProfilerSnippet: snippet };
	} catch (e) {
		return {
			ok: false,
			pmset: "",
			systemProfilerSnippet: "",
			error: (e as Error).message,
		};
	}
}

export function listAudioOutputs(): {
	readonly ok: boolean;
	readonly devices: string[];
	readonly outputs: string[];
	readonly inputs: string[];
	readonly rawPreview: string;
	readonly error?: string;
} {
	try {
		const data = helperAudioList();
		const outputNames = data.outputs.map((d) => d.name);
		const inputNames = data.inputs.map((d) => d.name);
		return {
			ok: true,
			devices: outputNames,
			outputs: outputNames,
			inputs: inputNames,
			rawPreview: JSON.stringify(data).slice(0, 2000),
		};
	} catch (e) {
		return {
			ok: false,
			devices: [],
			outputs: [],
			inputs: [],
			rawPreview: "",
			error: (e as Error).message,
		};
	}
}

export function switchAudioOutput(deviceSubstring: string): {
	ok: boolean;
	code: number | null;
	stdout: string;
	stderr: string;
} {
	try {
		const result = helperAudioSwitchOutput(deviceSubstring);
		return {
			ok: true,
			code: 0,
			stdout: `Switched to ${result.name}`,
			stderr: "",
		};
	} catch (e) {
		return { ok: false, code: 1, stdout: "", stderr: (e as Error).message };
	}
}

export function bluetoothSetPower(enabled: boolean): {
	ok: boolean;
	code: number | null;
	stdout: string;
	stderr: string;
} {
	try {
		const result = helperBluetoothPower(enabled);
		if (!result.success) {
			return {
				ok: false,
				code: 1,
				stdout: "",
				stderr: `Bluetooth power state: ${result.actual} (requested ${enabled ? "on" : "off"})`,
			};
		}
		return {
			ok: true,
			code: 0,
			stdout: `Bluetooth ${enabled ? "enabled" : "disabled"}`,
			stderr: "",
		};
	} catch (e) {
		return { ok: false, code: 1, stdout: "", stderr: (e as Error).message };
	}
}

export function runShortcut(shortcutName: string): {
	ok: boolean;
	code: number | null;
	stdout: string;
	stderr: string;
} {
	try {
		const result = helperShortcutsRun(shortcutName);
		return { ok: true, code: 0, stdout: result.output, stderr: "" };
	} catch (e) {
		return { ok: false, code: 1, stdout: "", stderr: (e as Error).message };
	}
}

export function pmsetLowPowerModeGet(): {
	ok: boolean;
	stdout: string;
	stderr: string;
} {
	try {
		const data = helperLowPowerStatus();
		return {
			ok: true,
			stdout: `lowpowermode ${data.lowPowerMode}`,
			stderr: "",
		};
	} catch (e) {
		return { ok: false, stdout: "", stderr: (e as Error).message };
	}
}

export function pmsetLowPowerModeSet(enabled: boolean): {
	ok: boolean;
	stdout: string;
	stderr: string;
} {
	try {
		const data = helperLowPowerSet(enabled);
		return {
			ok: true,
			stdout: `lowpowermode ${data.lowPowerMode}`,
			stderr: "",
		};
	} catch (e) {
		return { ok: false, stdout: "", stderr: (e as Error).message };
	}
}

// MARK: - New capabilities

export function getSystemVolume(): {
	ok: boolean;
	volume: number | undefined;
	muted: boolean | undefined;
	error?: string;
} {
	try {
		const data = helperAudioVolume();
		return { ok: true, volume: data.volume, muted: data.muted };
	} catch (e) {
		return {
			ok: false,
			volume: undefined,
			muted: undefined,
			error: (e as Error).message,
		};
	}
}

export function setSystemVolume(level: number): {
	ok: boolean;
	error?: string;
} {
	try {
		helperAudioSetVolume(level);
		return { ok: true };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

export function setSystemMute(muted: boolean): { ok: boolean; error?: string } {
	try {
		helperAudioSetMute(muted);
		return { ok: true };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

export function getDisplayBrightness(): {
	ok: boolean;
	brightness: number;
	percent: number;
	error?: string;
} {
	try {
		const data = helperDisplayBrightness();
		const main = data.displays.find((d) => d.isMainDisplay) ?? data.displays[0];
		if (!main)
			return {
				ok: false,
				brightness: 0,
				percent: 0,
				error: "No display found",
			};
		return { ok: true, brightness: main.brightness, percent: main.percent };
	} catch (e) {
		return {
			ok: false,
			brightness: 0,
			percent: 0,
			error: (e as Error).message,
		};
	}
}

export function setDisplayBrightness(level: number): {
	ok: boolean;
	error?: string;
} {
	try {
		helperDisplaySetBrightness(level);
		return { ok: true };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

export function readClipboard(): {
	ok: boolean;
	text: string;
	hasContent: boolean;
	error?: string;
} {
	try {
		const data = helperClipboardRead();
		return { ok: true, text: data.text, hasContent: data.hasContent };
	} catch (e) {
		return {
			ok: false,
			text: "",
			hasContent: false,
			error: (e as Error).message,
		};
	}
}

export function writeClipboard(text: string): { ok: boolean; error?: string } {
	try {
		helperClipboardWrite(text);
		return { ok: true };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

export function getSystemInfo(): {
	ok: boolean;
	data?: SystemInfoData;
	error?: string;
} {
	try {
		const data = helperSystemInfo();
		return { ok: true, data };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

export async function smokeTestMacOSSubsystem(): Promise<void> {
	if (!isMacOSIntegrationSupported()) {
		throw new Error("macOS integration requires macOS.");
	}
	try {
		helperSystemInfo();
	} catch (e) {
		throw new Error(`macOS system helper test failed: ${(e as Error).message}`);
	}
}
