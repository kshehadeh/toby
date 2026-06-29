import { isNativeAvailable, nativeRequest } from "./native-client";

type JsonRecord = Record<string, unknown>;

export type ToolDefinition = {
	name: string;
	displayName: string;
	description: string;
	readOnly?: boolean;
	inputSchema: {
		type: string;
		properties: Record<string, { type: string; description: string }>;
		required?: string[];
	};
};

function prop(
	type: string,
	description: string,
): { type: string; description: string } {
	return { type, description };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
	{
		name: "macBatteryStatus",
		displayName: "Battery status",
		description:
			"macOS only. Read battery / power snapshot: condition, charge percent, cycle count, charging state, and power source. Uses native IOKit APIs.",
		readOnly: true,
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "macWifiStatus",
		displayName: "Wi-Fi status",
		description:
			"macOS only. Show Wi‑Fi power state, current SSID, BSSID, and RSSI using native CoreWLAN APIs.",
		readOnly: true,
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "macWifiScanNearby",
		displayName: "Scan nearby Wi-Fi",
		description:
			"macOS only. Scan nearby Wi‑Fi networks using native CoreWLAN. Returns SSIDs, BSSIDs, and RSSI values. Wi‑Fi should be ON. May require Location Services permission.",
		readOnly: true,
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "macWifiSetPower",
		displayName: "Set Wi-Fi power",
		description: "macOS only. Turn Wi‑Fi radio on/off using native CoreWLAN.",
		inputSchema: {
			type: "object",
			properties: { enabled: prop("boolean", "true = On, false = Off") },
			required: ["enabled"],
		},
	},
	{
		name: "macAudioListOutputs",
		displayName: "List audio outputs",
		description:
			"macOS only. List audio output and input device names using native CoreAudio APIs. Shows device names, UIDs, and default status.",
		readOnly: true,
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "macAudioSwitchOutput",
		displayName: "Switch audio output",
		description:
			"macOS only. Set default output audio device using native CoreAudio. Use this whenever the user asks to switch/change/set audio output. If the device name is not known, call macAudioListOutputs first.",
		inputSchema: {
			type: "object",
			properties: {
				deviceSubstring: prop(
					"string",
					"Substring of output device name, e.g. MacBook Speakers",
				),
			},
			required: ["deviceSubstring"],
		},
	},
	{
		name: "macAudioVolume",
		displayName: "Get audio volume",
		description:
			"macOS only. Get the current system output volume (0-100) and mute state using native CoreAudio.",
		readOnly: true,
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "macAudioSetVolume",
		displayName: "Set audio volume",
		description:
			"macOS only. Set system output volume (0-100) using native CoreAudio. Automatically unmutes if level > 0.",
		inputSchema: {
			type: "object",
			properties: { level: prop("number", "Volume level 0-100") },
			required: ["level"],
		},
	},
	{
		name: "macAudioSetMute",
		displayName: "Set audio mute",
		description:
			"macOS only. Mute or unmute the system audio output using native CoreAudio.",
		inputSchema: {
			type: "object",
			properties: { muted: prop("boolean", "true = mute, false = unmute") },
			required: ["muted"],
		},
	},
	{
		name: "macBluetoothStatus",
		displayName: "Bluetooth status",
		description:
			"macOS only. Read Bluetooth power state and paired/connected devices using native IOBluetooth APIs.",
		readOnly: true,
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "macBluetoothSetPower",
		displayName: "Set Bluetooth power",
		description:
			"macOS only. Enable/disable Bluetooth using native IOBluetooth APIs. No third-party tools required.",
		inputSchema: {
			type: "object",
			properties: { enabled: prop("boolean", "") },
			required: ["enabled"],
		},
	},
	{
		name: "macLowPowerModeStatus",
		displayName: "Low power mode status",
		description:
			"macOS only. Read low power mode state (may not be available on desktops).",
		readOnly: true,
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "macLowPowerModeSet",
		displayName: "Set low power mode",
		description:
			"macOS only. Set low power mode on/off. May fail without admin privileges.",
		inputSchema: {
			type: "object",
			properties: { enabled: prop("boolean", "") },
			required: ["enabled"],
		},
	},
	{
		name: "macFocusSet",
		displayName: "Set Focus / Do Not Disturb",
		description:
			'macOS only. Turn Do Not Disturb / Focus mode on or off on this Mac. Uses bundled Shortcuts "TobyFocusOn" and "TobyFocusOff" (install via `toby plugins setup macos` if missing). Prefer this over macShortcutRun for Focus/DND requests.',
		inputSchema: {
			type: "object",
			properties: {
				enabled: prop(
					"boolean",
					"true = enable Focus/Do Not Disturb, false = disable",
				),
			},
			required: ["enabled"],
		},
	},
	{
		name: "macShortcutRun",
		displayName: "Run shortcut",
		description:
			'macOS only. Run any Shortcuts.app shortcut by exact name. For Do Not Disturb / Focus, prefer macFocusSet; bundled shortcuts are "TobyFocusOn" and "TobyFocusOff".',
		inputSchema: {
			type: "object",
			properties: {
				name: prop("string", "Exact name of the Shortcut to run."),
			},
			required: ["name"],
		},
	},
	{
		name: "macDisplayBrightness",
		displayName: "Display brightness",
		description:
			"macOS only. Get the current display brightness level (0-100). May not be supported on all hardware configurations (e.g. some Apple Silicon Macs).",
		readOnly: true,
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "macDisplaySetBrightness",
		displayName: "Set display brightness",
		description:
			"macOS only. Set display brightness level (0-100). May not be supported on all hardware configurations.",
		inputSchema: {
			type: "object",
			properties: { level: prop("number", "Brightness level 0-100") },
			required: ["level"],
		},
	},
	{
		name: "macClipboardRead",
		displayName: "Read clipboard",
		description:
			"macOS only. Read the current text content of the system clipboard.",
		readOnly: true,
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "macClipboardWrite",
		displayName: "Write clipboard",
		description:
			"macOS only. Write text to the system clipboard, replacing any current content.",
		inputSchema: {
			type: "object",
			properties: { text: prop("string", "Text to write to clipboard") },
			required: ["text"],
		},
	},
	{
		name: "macSystemInfo",
		displayName: "System info",
		description:
			"macOS only. Get system information: OS version, hardware model, hostname, uptime, processor count, physical memory, and Apple Silicon status.",
		readOnly: true,
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "macNotificationsPeek",
		displayName: "Peek notifications",
		description:
			"macOS only. Read Notification Center items — not supported (no stable API). Does not toggle Do Not Disturb / Focus; use macFocusSet for that.",
		readOnly: true,
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "macWindowsHideAll",
		displayName: "Hide all other windows",
		description:
			'macOS only. Hide all other application windows (like the macOS "Hide Others" command). Uses native AppKit; no extra permission required.',
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "macWindowsShowAll",
		displayName: "Show all windows",
		description:
			"macOS only. Show/unhide all currently hidden application windows. Uses native AppKit; no extra permission required.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "macWindowsMinimizeAll",
		displayName: "Minimize all windows",
		description:
			"macOS only. Minimize all windows of all open applications via the native Accessibility API. Requires Accessibility permission for the app running Toby (System Settings → Privacy & Security → Accessibility).",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "macWindowsUnminimizeAll",
		displayName: "Unminimize all windows",
		description:
			"macOS only. Unminimize all minimized windows of all open applications via the native Accessibility API. Requires Accessibility permission.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "macWindowHideApp",
		displayName: "Hide app windows",
		description:
			"macOS only. Hide a specific running application's windows by name. Matches localized app name or bundle id substring (case-insensitive). Uses native AppKit.",
		inputSchema: {
			type: "object",
			properties: {
				appName: prop(
					"string",
					"App name to hide (e.g. Safari, Slack). Substring match is allowed.",
				),
			},
			required: ["appName"],
		},
	},
	{
		name: "macWindowMinimizeApp",
		displayName: "Minimize app windows",
		description:
			"macOS only. Minimize all windows of a specific running application via the native Accessibility API. Requires Accessibility permission.",
		inputSchema: {
			type: "object",
			properties: {
				appName: prop(
					"string",
					"App name to minimize (e.g. Safari, Slack). Substring match is allowed.",
				),
			},
			required: ["appName"],
		},
	},
	{
		name: "macWindowUnminimizeApp",
		displayName: "Unminimize app windows",
		description:
			"macOS only. Unminimize all minimized windows of a specific running application via the native Accessibility API. Requires Accessibility permission.",
		inputSchema: {
			type: "object",
			properties: {
				appName: prop(
					"string",
					"App name to unminimize (e.g. Safari, Slack). Substring match is allowed.",
				),
			},
			required: ["appName"],
		},
	},
];

export type ExecuteResult = {
	result: JsonRecord;
	appliedActions: string[];
};

export class ToolFailure extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ToolFailure";
	}
}

function requireNative(): void {
	if (!isNativeAvailable()) {
		throw new ToolFailure(
			"Toby.app native server is not available. Launch Toby.app to enable macOS system tools.",
		);
	}
}

function strValue(input: JsonRecord, key: string): string | undefined {
	const v = input[key];
	return typeof v === "string" ? v : undefined;
}

function boolValue(input: JsonRecord, key: string): boolean | undefined {
	const v = input[key];
	if (typeof v === "boolean") return v;
	return undefined;
}

function intValue(input: JsonRecord, key: string): number | undefined {
	const v = input[key];
	if (typeof v === "number") return v;
	return undefined;
}

export function executeTool(
	tool: string,
	input: JsonRecord,
	dryRun: boolean,
): ExecuteResult {
	const FOCUS_ON = "TobyFocusOn";
	const FOCUS_OFF = "TobyFocusOff";

	switch (tool) {
		case "macBatteryStatus": {
			if (dryRun)
				return {
					result: {
						dryRun: true,
						message: "Would read battery / power snapshot.",
					},
					appliedActions: [],
				};
			requireNative();
			const r = nativeRequest("macos/battery-status");
			if (!r.ok)
				return {
					result: { ok: false, error: r.error ?? "Failed" },
					appliedActions: [],
				};
			const d = r.data ?? {};
			const pmset = [
				d.powerSourceState === "AC Power" ? "AC Power" : "Battery Power",
				d.isCharging === true ? "Charging" : "Not Charging",
				`${d.chargePercent ?? 0}%`,
			].join("; ");
			const snippet = [
				`Condition: ${d.sourceType ?? "unknown"}`,
				`Charge: ${d.chargePercent ?? 0}%`,
				`Cycles: ${d.cycleCount ?? -1}`,
				`Max Capacity: ${d.maxCapacity ?? -1}%`,
			].join("\n");
			return {
				result: { ok: true, pmset, systemProfilerBatteryText: snippet },
				appliedActions: [],
			};
		}

		case "macWifiStatus": {
			if (dryRun)
				return {
					result: { dryRun: true, message: "Would query Wi‑Fi state." },
					appliedActions: [],
				};
			requireNative();
			const r = nativeRequest("macos/wifi-status");
			if (!r.ok)
				return {
					result: { ok: false, error: r.error ?? "Failed" },
					appliedActions: [],
				};
			const d = r.data ?? {};
			const statusLine = d.powerOn === true ? "Power: On" : "Power: Off";
			return {
				result: { device: d.interface ?? "unknown", ok: true, statusLine },
				appliedActions: [],
			};
		}

		case "macWifiScanNearby": {
			if (dryRun)
				return {
					result: { dryRun: true, message: "Would scan for nearby Wi‑Fi." },
					appliedActions: [],
				};
			requireNative();
			const r = nativeRequest("macos/wifi-scan");
			if (!r.ok)
				return {
					result: {
						ok: false,
						device: null,
						error: r.error ?? "Failed",
						networks: [],
						scanSource: "corewlan",
						rawPreviewTail: "",
					},
					appliedActions: [],
				};
			const d = r.data ?? {};
			const networks = Array.isArray(d.networks)
				? (d.networks as JsonRecord[]).map((net) => ({
						ssid: net.ssid ?? "",
						bssid: net.bssid ?? "",
						rssi: net.rssi ?? 0,
					}))
				: [];
			return {
				result: {
					ok: true,
					device: d.interface ?? "",
					networks,
					scanSource: "corewlan",
					rawPreviewTail: "",
				},
				appliedActions: [],
			};
		}

		case "macWifiSetPower": {
			const enabled = boolValue(input, "enabled");
			if (enabled === undefined) throw new ToolFailure("enabled is required.");
			if (dryRun)
				return {
					result: {
						dryRun: true,
						message: `[DRY RUN] Would ${enabled ? "enable" : "disable"} Wi‑Fi.`,
					},
					appliedActions: [
						`[DRY RUN] Would ${enabled ? "enable" : "disable"} Wi‑Fi.`,
					],
				};
			requireNative();
			const r = nativeRequest("macos/wifi-set-power", { enabled });
			if (!r.ok)
				return {
					result: { ok: false, error: r.error ?? "Failed" },
					appliedActions: [],
				};
			const action = `Wi‑Fi ${enabled ? "turned On" : "turned Off"}.`;
			return {
				result: {
					ok: true,
					device: r.data?.interface ?? "unknown",
					message: "Wi‑Fi power set successfully",
				},
				appliedActions: [action],
			};
		}

		case "macAudioListOutputs": {
			if (dryRun)
				return {
					result: {
						dryRun: true,
						message: "Would list audio output and input devices.",
					},
					appliedActions: [],
				};
			requireNative();
			const r = nativeRequest("macos/audio-list-outputs");
			if (!r.ok)
				return {
					result: { ok: false, error: r.error ?? "Failed" },
					appliedActions: [],
				};
			const d = r.data ?? {};
			const outputs = Array.isArray(d.outputs)
				? (d.outputs as JsonRecord[]).map((o) => String(o.name ?? ""))
				: [];
			const inputs = Array.isArray(d.inputs)
				? (d.inputs as JsonRecord[]).map((o) => String(o.name ?? ""))
				: [];
			return {
				result: {
					ok: true,
					devices: outputs,
					outputs,
					inputs,
					hintForSwitchTool:
						outputs.length === 0
							? "Use macAudioSwitchOutput with a substring matching an entry."
							: "These are the available output device names. If the user requested a target that clearly matches one, call macAudioSwitchOutput next with that exact or substring name; do not stop after listing.",
				},
				appliedActions: [],
			};
		}

		case "macAudioSwitchOutput": {
			const deviceSubstring = strValue(input, "deviceSubstring")?.trim();
			if (!deviceSubstring)
				throw new ToolFailure("deviceSubstring is required.");
			if (dryRun)
				return {
					result: {
						dryRun: true,
						message: `Would switch audio output matching "${deviceSubstring}".`,
					},
					appliedActions: [
						`[DRY RUN] Would switch audio output matching "${deviceSubstring}".`,
					],
				};
			requireNative();
			const r = nativeRequest("macos/audio-switch-output", { deviceSubstring });
			if (!r.ok)
				return {
					result: { ok: false, error: r.error ?? "Failed" },
					appliedActions: [],
				};
			return {
				result: {
					ok: true,
					stdout: `Switched to ${r.data?.name ?? deviceSubstring}`,
				},
				appliedActions: [
					`Switched audio output to match "${deviceSubstring}".`,
				],
			};
		}

		case "macAudioVolume": {
			if (dryRun)
				return {
					result: { dryRun: true, message: "Would read system volume." },
					appliedActions: [],
				};
			requireNative();
			const r = nativeRequest("macos/audio-volume");
			if (!r.ok)
				return {
					result: { ok: false, error: r.error ?? "Failed" },
					appliedActions: [],
				};
			return {
				result: { ok: true, volume: r.data?.volume, muted: r.data?.muted },
				appliedActions: [],
			};
		}

		case "macAudioSetVolume": {
			const level = intValue(input, "level");
			if (level === undefined || level < 0 || level > 100)
				throw new ToolFailure("level must be 0-100.");
			if (dryRun)
				return {
					result: { dryRun: true },
					appliedActions: [`[DRY RUN] Would set volume to ${level}.`],
				};
			requireNative();
			const r = nativeRequest("macos/audio-set-volume", { level });
			if (!r.ok)
				return {
					result: { ok: false, error: r.error ?? "Failed" },
					appliedActions: [],
				};
			return {
				result: { ok: true, level },
				appliedActions: [`Volume set to ${level}.`],
			};
		}

		case "macAudioSetMute": {
			const muted = boolValue(input, "muted");
			if (muted === undefined) throw new ToolFailure("muted is required.");
			if (dryRun)
				return {
					result: { dryRun: true },
					appliedActions: [
						`[DRY RUN] Would ${muted ? "mute" : "unmute"} audio.`,
					],
				};
			requireNative();
			const r = nativeRequest("macos/audio-set-mute", { muted });
			if (!r.ok)
				return {
					result: { ok: false, error: r.error ?? "Failed" },
					appliedActions: [],
				};
			return {
				result: { ok: true, muted },
				appliedActions: [`Audio ${muted ? "muted" : "unmuted"}.`],
			};
		}

		case "macBluetoothStatus": {
			if (dryRun)
				return {
					result: { dryRun: true, message: "Would read Bluetooth status." },
					appliedActions: [],
				};
			requireNative();
			const r = nativeRequest("macos/bluetooth-status");
			if (!r.ok)
				return {
					result: { ok: false, error: r.error ?? "Failed" },
					appliedActions: [],
				};
			return {
				result: {
					ok: true,
					powerState: r.data?.powerState,
					devices: r.data?.devices,
					deviceCount: r.data?.deviceCount,
				},
				appliedActions: [],
			};
		}

		case "macBluetoothSetPower": {
			const enabled = boolValue(input, "enabled");
			if (enabled === undefined) throw new ToolFailure("enabled is required.");
			if (dryRun)
				return {
					result: { dryRun: true },
					appliedActions: [
						`[DRY RUN] Would ${enabled ? "enable" : "disable"} Bluetooth.`,
					],
				};
			requireNative();
			const r = nativeRequest("macos/bluetooth-set-power", { enabled });
			if (!r.ok)
				return {
					result: { ok: false, error: r.error ?? "Failed" },
					appliedActions: [],
				};
			if (r.data?.success !== true) {
				return {
					result: {
						ok: false,
						error: `Bluetooth power state: ${r.data?.actual ?? "unknown"} (requested ${enabled ? "on" : "off"})`,
					},
					appliedActions: [],
				};
			}
			return {
				result: { ok: true },
				appliedActions: [`Bluetooth ${enabled ? "enabled" : "disabled"}.`],
			};
		}

		case "macLowPowerModeStatus": {
			if (dryRun)
				return {
					result: { dryRun: true, message: "Would read low power mode state." },
					appliedActions: [],
				};
			requireNative();
			const r = nativeRequest("macos/low-power-status");
			if (!r.ok)
				return {
					result: { ok: false, raw: "", error: r.error ?? "Failed" },
					appliedActions: [],
				};
			return {
				result: { ok: true, raw: `lowpowermode ${r.data?.lowPowerMode ?? ""}` },
				appliedActions: [],
			};
		}

		case "macLowPowerModeSet": {
			const enabled = boolValue(input, "enabled");
			if (enabled === undefined) throw new ToolFailure("enabled is required.");
			if (dryRun)
				return {
					result: { dryRun: true },
					appliedActions: [
						`[DRY RUN] Would set low power mode ${enabled ? "on" : "off"}.`,
					],
				};
			requireNative();
			const r = nativeRequest("macos/low-power-set", { enabled });
			if (!r.ok)
				return {
					result: { ok: false, stdout: "", error: r.error ?? "Failed" },
					appliedActions: [],
				};
			return {
				result: {
					ok: true,
					stdout: `lowpowermode ${r.data?.lowPowerMode ?? ""}`,
				},
				appliedActions: [`Low power mode → ${enabled ? "on" : "off"}.`],
			};
		}

		case "macFocusSet": {
			const enabled = boolValue(input, "enabled");
			if (enabled === undefined) throw new ToolFailure("enabled is required.");
			const shortcutName = enabled ? FOCUS_ON : FOCUS_OFF;
			if (dryRun)
				return {
					result: { dryRun: true, shortcutName },
					appliedActions: [
						`[DRY RUN] Would ${enabled ? "enable" : "disable"} Focus / Do Not Disturb via "${shortcutName}".`,
					],
				};
			requireNative();
			const r = nativeRequest("macos/shortcuts-run", { name: shortcutName });
			if (!r.ok) {
				return {
					result: {
						ok: false,
						enabled,
						shortcutName,
						error: r.error ?? "Failed",
						hint: "Run `toby plugins setup macos` to install bundled Focus shortcuts, then confirm each import in Shortcuts.app.",
					},
					appliedActions: [],
				};
			}
			const output = String(r.data?.output ?? "");
			return {
				result: {
					ok: true,
					enabled,
					shortcutName,
					stdoutTail: output.slice(-2000),
				},
				appliedActions: [
					`Focus / Do Not Disturb ${enabled ? "enabled" : "disabled"}.`,
				],
			};
		}

		case "macShortcutRun": {
			const shortcutName = strValue(input, "name")?.trim();
			if (!shortcutName)
				return {
					result: { ok: false, error: "Shortcut name is required." },
					appliedActions: [],
				};
			if (dryRun)
				return {
					result: { dryRun: true, shortcutName },
					appliedActions: [`[DRY RUN] shortcuts run "${shortcutName}"`],
				};
			requireNative();
			const r = nativeRequest("macos/shortcuts-run", { name: shortcutName });
			if (!r.ok)
				return {
					result: { ok: false, shortcutName, error: r.error ?? "Failed" },
					appliedActions: [],
				};
			const output = String(r.data?.output ?? "");
			return {
				result: { ok: true, shortcutName, stdoutTail: output.slice(-2000) },
				appliedActions: [`Shortcuts ran "${shortcutName}".`],
			};
		}

		case "macDisplayBrightness": {
			if (dryRun)
				return {
					result: { dryRun: true, message: "Would read display brightness." },
					appliedActions: [],
				};
			requireNative();
			const r = nativeRequest("macos/display-brightness");
			if (!r.ok)
				return {
					result: { ok: false, error: r.error ?? "Failed" },
					appliedActions: [],
				};
			const displays = Array.isArray(r.data?.displays)
				? (r.data?.displays as JsonRecord[])
				: [];
			const main = displays[0];
			if (!main)
				return {
					result: { ok: false, error: "No display found" },
					appliedActions: [],
				};
			return {
				result: {
					ok: true,
					brightness: main.brightness,
					percent: main.percent,
				},
				appliedActions: [],
			};
		}

		case "macDisplaySetBrightness": {
			const level = intValue(input, "level");
			if (level === undefined || level < 0 || level > 100)
				throw new ToolFailure("level must be 0-100.");
			if (dryRun)
				return {
					result: { dryRun: true },
					appliedActions: [
						`[DRY RUN] Would set display brightness to ${level}.`,
					],
				};
			requireNative();
			const r = nativeRequest("macos/display-set-brightness", { level });
			if (!r.ok)
				return {
					result: { ok: false, error: r.error ?? "Failed" },
					appliedActions: [],
				};
			return {
				result: { ok: true, level },
				appliedActions: [`Display brightness set to ${level}.`],
			};
		}

		case "macClipboardRead": {
			if (dryRun)
				return {
					result: { dryRun: true, message: "Would read clipboard." },
					appliedActions: [],
				};
			requireNative();
			const r = nativeRequest("macos/clipboard-read");
			if (!r.ok)
				return {
					result: { ok: false, error: r.error ?? "Failed" },
					appliedActions: [],
				};
			return {
				result: {
					ok: true,
					text: r.data?.text,
					hasContent: r.data?.hasContent,
				},
				appliedActions: [],
			};
		}

		case "macClipboardWrite": {
			const text = strValue(input, "text");
			if (text === undefined) throw new ToolFailure("text is required.");
			if (dryRun)
				return {
					result: { dryRun: true },
					appliedActions: ["[DRY RUN] Would write text to clipboard."],
				};
			requireNative();
			const r = nativeRequest("macos/clipboard-write", { text });
			if (!r.ok)
				return {
					result: { ok: false, error: r.error ?? "Failed" },
					appliedActions: [],
				};
			return {
				result: { ok: true },
				appliedActions: ["Copied text to clipboard."],
			};
		}

		case "macSystemInfo": {
			if (dryRun)
				return {
					result: { dryRun: true, message: "Would read system info." },
					appliedActions: [],
				};
			requireNative();
			const r = nativeRequest("macos/system-info");
			if (!r.ok)
				return {
					result: { ok: false, error: r.error ?? "Failed" },
					appliedActions: [],
				};
			return { result: { ok: true, ...r.data }, appliedActions: [] };
		}

		case "macNotificationsPeek": {
			return {
				result: {
					supported: false,
					message:
						"Toby cannot list Notification Center items via a stable public API. To turn Do Not Disturb / Focus on or off, use macFocusSet instead.",
				},
				appliedActions: [],
			};
		}

		case "macWindowsHideAll": {
			if (dryRun)
				return {
					result: {
						dryRun: true,
						message: "[DRY RUN] Would hide all other application windows.",
					},
					appliedActions: [
						"[DRY RUN] Would hide all other application windows.",
					],
				};
			requireNative();
			const r = nativeRequest("macos/windows-hide-all");
			if (!r.ok)
				return {
					result: { ok: false, error: r.error ?? "Failed" },
					appliedActions: [],
				};
			const count = Number(r.data?.hiddenCount ?? 0);
			return {
				result: {
					ok: true,
					hiddenCount: count,
					hiddenApps: r.data?.hiddenApps ?? [],
				},
				appliedActions: [`Hid ${count} other application(s).`],
			};
		}

		case "macWindowsShowAll": {
			if (dryRun)
				return {
					result: {
						dryRun: true,
						message: "[DRY RUN] Would unhide all hidden applications.",
					},
					appliedActions: ["[DRY RUN] Would unhide all hidden applications."],
				};
			requireNative();
			const r = nativeRequest("macos/windows-show-all");
			if (!r.ok)
				return {
					result: { ok: false, error: r.error ?? "Failed" },
					appliedActions: [],
				};
			const count = Number(r.data?.shownCount ?? 0);
			return {
				result: {
					ok: true,
					shownCount: count,
					shownApps: r.data?.shownApps ?? [],
				},
				appliedActions: [`Unhid ${count} application(s).`],
			};
		}

		case "macWindowsMinimizeAll": {
			if (dryRun)
				return {
					result: {
						dryRun: true,
						message:
							"[DRY RUN] Would minimize all windows of all open applications.",
					},
					appliedActions: [
						"[DRY RUN] Would minimize all windows of all open applications.",
					],
				};
			requireNative();
			const r = nativeRequest("macos/minimize-all");
			if (!r.ok)
				return {
					result: { ok: false, error: r.error ?? "Failed" },
					appliedActions: [],
				};
			const count = Number(r.data?.minimizedWindowCount ?? 0);
			return {
				result: {
					ok: true,
					minimizedWindowCount: count,
					apps: r.data?.apps ?? [],
				},
				appliedActions: [`Minimized ${count} window(s).`],
			};
		}

		case "macWindowsUnminimizeAll": {
			if (dryRun)
				return {
					result: {
						dryRun: true,
						message:
							"[DRY RUN] Would unminimize all minimized windows of all open applications.",
					},
					appliedActions: [
						"[DRY RUN] Would unminimize all minimized windows of all open applications.",
					],
				};
			requireNative();
			const r = nativeRequest("macos/unminimize-all");
			if (!r.ok)
				return {
					result: { ok: false, error: r.error ?? "Failed" },
					appliedActions: [],
				};
			const count = Number(r.data?.unminimizedWindowCount ?? 0);
			return {
				result: {
					ok: true,
					unminimizedWindowCount: count,
					apps: r.data?.apps ?? [],
				},
				appliedActions: [`Unminimized ${count} window(s).`],
			};
		}

		case "macWindowHideApp": {
			const appName = strValue(input, "appName")?.trim();
			if (!appName) throw new ToolFailure("appName is required.");
			if (dryRun)
				return {
					result: {
						dryRun: true,
						message: `[DRY RUN] Would hide "${appName}".`,
					},
					appliedActions: [`[DRY RUN] Would hide "${appName}".`],
				};
			requireNative();
			const r = nativeRequest("macos/window-hide-app", { appName });
			if (!r.ok)
				return {
					result: { ok: false, error: r.error ?? "Failed" },
					appliedActions: [],
				};
			const count = Number(r.data?.hiddenCount ?? 0);
			return {
				result: {
					ok: true,
					hiddenCount: count,
					hiddenApps: r.data?.hiddenApps ?? [],
				},
				appliedActions: [`Hid ${count} app(s) matching "${appName}".`],
			};
		}

		case "macWindowMinimizeApp": {
			const appName = strValue(input, "appName")?.trim();
			if (!appName) throw new ToolFailure("appName is required.");
			if (dryRun)
				return {
					result: {
						dryRun: true,
						message: `[DRY RUN] Would minimize windows of "${appName}".`,
					},
					appliedActions: [`[DRY RUN] Would minimize windows of "${appName}".`],
				};
			requireNative();
			const r = nativeRequest("macos/minimize-app", { name: appName });
			if (!r.ok)
				return {
					result: { ok: false, error: r.error ?? "Failed" },
					appliedActions: [],
				};
			const count = Number(r.data?.minimizedWindowCount ?? 0);
			return {
				result: {
					ok: true,
					minimizedWindowCount: count,
					apps: r.data?.apps ?? [],
				},
				appliedActions: [`Minimized ${count} window(s) of "${appName}".`],
			};
		}

		case "macWindowUnminimizeApp": {
			const appName = strValue(input, "appName")?.trim();
			if (!appName) throw new ToolFailure("appName is required.");
			if (dryRun)
				return {
					result: {
						dryRun: true,
						message: `[DRY RUN] Would unminimize windows of "${appName}".`,
					},
					appliedActions: [
						`[DRY RUN] Would unminimize windows of "${appName}".`,
					],
				};
			requireNative();
			const r = nativeRequest("macos/unminimize-app", { name: appName });
			if (!r.ok)
				return {
					result: { ok: false, error: r.error ?? "Failed" },
					appliedActions: [],
				};
			const count = Number(r.data?.unminimizedWindowCount ?? 0);
			return {
				result: {
					ok: true,
					unminimizedWindowCount: count,
					apps: r.data?.apps ?? [],
				},
				appliedActions: [`Unminimized ${count} window(s) of "${appName}".`],
			};
		}

		default:
			throw new ToolFailure(`Unknown tool: ${tool}`);
	}
}
