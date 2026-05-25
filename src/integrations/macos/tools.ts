import { tool } from "ai";
import { z } from "zod";
import {
	bluetoothSetPower,
	getBatteryStatus,
	getDisplayBrightness,
	getSystemInfo,
	getSystemVolume,
	isMacOSIntegrationSupported,
	listAudioOutputs,
	pmsetLowPowerModeGet,
	pmsetLowPowerModeSet,
	readClipboard,
	resolvePreferredWifiInterface,
	runShortcut,
	setDisplayBrightness,
	setSystemMute,
	setSystemVolume,
	switchAudioOutput,
	wifiPowerGet,
	wifiPowerSet,
	wifiScanNearby,
	writeClipboard,
} from "./client";

export interface MacOSToolContext {
	readonly dryRun: boolean;
	readonly appliedActions: string[];
}

export function createMacOSTools(ctx: MacOSToolContext) {
	return {
		macBatteryStatus: tool({
			description:
				"macOS only. Read battery / power snapshot: condition, charge percent, cycle count, charging state, and power source. Uses native IOKit APIs.",
			inputSchema: z.object({}),
			execute: async () => {
				if (!isMacOSIntegrationSupported()) {
					return { error: "macOS integration tools run only on macOS." };
				}
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: "Would read battery / power snapshot.",
					};
				}
				const r = getBatteryStatus();
				if (!r.ok) {
					return {
						ok: false,
						error: r.error,
						pmset: r.pmset,
						snippet: r.systemProfilerSnippet,
					};
				}
				return {
					ok: true,
					pmset: r.pmset,
					systemProfilerBatteryText: r.systemProfilerSnippet,
				};
			},
		}),

		macWifiStatus: tool({
			description:
				"macOS only. Show Wi‑Fi power state, current SSID, BSSID, and RSSI using native CoreWLAN APIs.",
			inputSchema: z.object({}),
			execute: async () => {
				if (!isMacOSIntegrationSupported()) {
					return { error: "macOS only." };
				}
				if (ctx.dryRun) {
					return { dryRun: true, message: "Would query Wi‑Fi state." };
				}
				const dev = resolvePreferredWifiInterface();
				if (!dev) {
					return { ok: false, error: "Could not resolve Wi‑Fi interface." };
				}
				const st = wifiPowerGet(dev);
				return { device: dev, ok: st.ok, statusLine: st.stdout || st.stderr };
			},
		}),

		macWifiScanNearby: tool({
			description:
				"macOS only. Scan nearby Wi‑Fi networks using native CoreWLAN. Returns SSIDs, BSSIDs, and RSSI values. Wi‑Fi should be ON. May require Location Services permission.",
			inputSchema: z.object({}),
			execute: async () => {
				if (!isMacOSIntegrationSupported()) {
					return { error: "macOS only." };
				}
				if (ctx.dryRun) {
					return { dryRun: true, message: "Would scan for nearby Wi‑Fi." };
				}
				const r = wifiScanNearby();
				if (!r.ok) {
					return {
						ok: false,
						device: r.device,
						error: r.error,
						networks: r.networks,
						scanSource: r.scanSource,
						rawPreviewTail: r.rawPreview,
					};
				}
				return {
					ok: true,
					device: r.device,
					networks: r.networks,
					scanSource: r.scanSource,
					hint:
						r.networks.length === 0 && r.rawPreview.trim().length > 0
							? "Parsed zero BSSIDs — Wi‑Fi may be off."
							: undefined,
					rawPreviewTail: r.rawPreview.slice(-4500),
				};
			},
		}),

		macWifiSetPower: tool({
			description: "macOS only. Turn Wi‑Fi radio on/off using native CoreWLAN.",
			inputSchema: z.object({
				enabled: z.boolean().describe("true = On, false = Off"),
			}),
			execute: async ({ enabled }) => {
				if (!isMacOSIntegrationSupported()) {
					return { error: "macOS only." };
				}
				if (ctx.dryRun) {
					ctx.appliedActions.push(
						`[DRY RUN] Would ${enabled ? "enable" : "disable"} Wi‑Fi.`,
					);
					return {
						dryRun: true,
						message: `[DRY RUN] Would ${enabled ? "enable" : "disable"} Wi‑Fi.`,
					};
				}
				const dev = resolvePreferredWifiInterface();
				if (!dev) {
					return { ok: false, error: "No Wi‑Fi interface found." };
				}
				const r = wifiPowerSet(dev, enabled);
				if (r.ok) {
					ctx.appliedActions.push(
						`Wi‑Fi ${enabled ? "turned On" : "turned Off"} on ${dev}.`,
					);
				}
				return {
					ok: r.ok,
					device: dev,
					...(r.ok
						? { message: "Wi‑Fi power set successfully" }
						: { error: r.stderr.trim() || "Failed to set Wi‑Fi power" }),
				};
			},
		}),

		macAudioListOutputs: tool({
			description:
				"macOS only. List audio output and input device names using native CoreAudio APIs. Shows device names, UIDs, and default status.",
			inputSchema: z.object({}),
			execute: async () => {
				if (!isMacOSIntegrationSupported()) {
					return { error: "macOS only." };
				}
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message: "Would list audio output and input devices.",
					};
				}
				const r = listAudioOutputs();
				if (!r.ok) {
					return { ok: false, error: r.error, rawPreviewTail: r.rawPreview };
				}
				return {
					ok: true,
					devices: r.devices,
					outputs: r.outputs,
					inputs: r.inputs,
					hintForSwitchTool:
						r.outputs.length > 0
							? "These are the available output device names. If the user requested a target that clearly matches one, call macAudioSwitchOutput next with that exact or substring name; do not stop after listing."
							: "Use macAudioSwitchOutput with a substring matching an entry.",
				};
			},
		}),

		macAudioSwitchOutput: tool({
			description:
				"macOS only. Set default output audio device using native CoreAudio. Use this whenever the user asks to switch/change/set audio output. If the device name is not known, call macAudioListOutputs first.",
			inputSchema: z.object({
				deviceSubstring: z
					.string()
					.describe("Substring of output device name, e.g. MacBook Speakers"),
			}),
			execute: async ({ deviceSubstring }) => {
				if (!isMacOSIntegrationSupported()) {
					return { error: "macOS only." };
				}
				if (ctx.dryRun) {
					ctx.appliedActions.push(
						`[DRY RUN] Would switch audio output matching "${deviceSubstring}".`,
					);
					return { dryRun: true, message: "Would switch audio output." };
				}
				const r = switchAudioOutput(deviceSubstring.trim());
				if (r.ok) {
					ctx.appliedActions.push(
						`Switched audio output to match "${deviceSubstring}".`,
					);
				}
				return {
					ok: r.ok,
					...(r.ok
						? { stdout: r.stdout.trim() }
						: { error: r.stderr.trim() || "Audio switch failed" }),
				};
			},
		}),

		macAudioVolume: tool({
			description:
				"macOS only. Get the current system output volume (0-100) and mute state using native CoreAudio.",
			inputSchema: z.object({}),
			execute: async () => {
				if (!isMacOSIntegrationSupported()) {
					return { error: "macOS only." };
				}
				if (ctx.dryRun) {
					return { dryRun: true, message: "Would read system volume." };
				}
				const r = getSystemVolume();
				if (!r.ok) {
					return { ok: false, error: r.error };
				}
				return { ok: true, volume: r.volume, muted: r.muted };
			},
		}),

		macAudioSetVolume: tool({
			description:
				"macOS only. Set system output volume (0-100) using native CoreAudio. Automatically unmutes if level > 0.",
			inputSchema: z.object({
				level: z.number().min(0).max(100).describe("Volume level 0-100"),
			}),
			execute: async ({ level }) => {
				if (!isMacOSIntegrationSupported()) {
					return { error: "macOS only." };
				}
				if (ctx.dryRun) {
					ctx.appliedActions.push(`[DRY RUN] Would set volume to ${level}.`);
					return { dryRun: true };
				}
				const r = setSystemVolume(level);
				if (r.ok) {
					ctx.appliedActions.push(`Volume set to ${level}.`);
				}
				return { ok: r.ok, ...(r.ok ? { level } : { error: r.error }) };
			},
		}),

		macAudioSetMute: tool({
			description:
				"macOS only. Mute or unmute the system audio output using native CoreAudio.",
			inputSchema: z.object({
				muted: z.boolean().describe("true = mute, false = unmute"),
			}),
			execute: async ({ muted }) => {
				if (!isMacOSIntegrationSupported()) {
					return { error: "macOS only." };
				}
				if (ctx.dryRun) {
					ctx.appliedActions.push(
						`[DRY RUN] Would ${muted ? "mute" : "unmute"} audio.`,
					);
					return { dryRun: true };
				}
				const r = setSystemMute(muted);
				if (r.ok) {
					ctx.appliedActions.push(`Audio ${muted ? "muted" : "unmuted"}.`);
				}
				return { ok: r.ok, ...(r.ok ? { muted } : { error: r.error }) };
			},
		}),

		macBluetoothSetPower: tool({
			description:
				"macOS only. Enable/disable Bluetooth using native IOBluetooth APIs. No third-party tools required.",
			inputSchema: z.object({
				enabled: z.boolean(),
			}),
			execute: async ({ enabled }) => {
				if (!isMacOSIntegrationSupported()) {
					return { error: "macOS only." };
				}
				if (ctx.dryRun) {
					ctx.appliedActions.push(
						`[DRY RUN] Would ${enabled ? "enable" : "disable"} Bluetooth.`,
					);
					return { dryRun: true };
				}
				const r = bluetoothSetPower(enabled);
				if (r.ok) {
					ctx.appliedActions.push(
						`Bluetooth ${enabled ? "enabled" : "disabled"}.`,
					);
				}
				return {
					ok: r.ok,
					...(r.ok
						? {}
						: { error: r.stderr.trim() || "Bluetooth power control failed" }),
				};
			},
		}),

		macLowPowerModeStatus: tool({
			description:
				"macOS only. Read low power mode state (may not be available on desktops).",
			inputSchema: z.object({}),
			execute: async () => {
				if (!isMacOSIntegrationSupported()) {
					return { error: "macOS only." };
				}
				if (ctx.dryRun) {
					return { dryRun: true, message: "Would read low power mode state." };
				}
				const r = pmsetLowPowerModeGet();
				return {
					ok: r.ok,
					raw: r.stdout || r.stderr,
					...(r.ok ? {} : { error: r.stderr.trim() }),
				};
			},
		}),

		macLowPowerModeSet: tool({
			description:
				"macOS only. Set low power mode on/off. May fail without admin privileges.",
			inputSchema: z.object({
				enabled: z.boolean(),
			}),
			execute: async ({ enabled }) => {
				if (!isMacOSIntegrationSupported()) {
					return { error: "macOS only." };
				}
				if (ctx.dryRun) {
					ctx.appliedActions.push(
						`[DRY RUN] Would set low power mode ${enabled ? "on" : "off"}.`,
					);
					return { dryRun: true };
				}
				const r = pmsetLowPowerModeSet(enabled);
				if (r.ok) {
					ctx.appliedActions.push(
						`Low power mode → ${enabled ? "on" : "off"}.`,
					);
				}
				return {
					ok: r.ok,
					stdout: r.stdout.trim(),
					...(r.ok
						? {}
						: {
								error:
									r.stderr.trim() ||
									"If permission is denied, run manually with privileges.",
							}),
				};
			},
		}),

		macShortcutRun: tool({
			description:
				"macOS only. Run a Shortcut by its exact Shortcuts.app name.",
			inputSchema: z.object({
				name: z.string().describe("Exact name of the Shortcut to run."),
			}),
			execute: async ({ name }) => {
				if (!isMacOSIntegrationSupported()) {
					return { error: "macOS only." };
				}
				const shortcutName = name.trim();
				if (!shortcutName) {
					return {
						ok: false,
						error: "Shortcut name is required.",
					};
				}
				if (ctx.dryRun) {
					ctx.appliedActions.push(`[DRY RUN] shortcuts run "${shortcutName}"`);
					return { dryRun: true, shortcutName };
				}
				const r = runShortcut(shortcutName);
				if (r.ok) {
					ctx.appliedActions.push(`Shortcuts ran "${shortcutName}".`);
				}
				return {
					ok: r.ok,
					shortcutName,
					...(r.ok
						? { stdoutTail: r.stdout.trim().slice(-2000) }
						: { error: r.stderr.trim() || "shortcuts CLI failed" }),
				};
			},
		}),

		macDisplayBrightness: tool({
			description:
				"macOS only. Get the current display brightness level (0-100). May not be supported on all hardware configurations (e.g. some Apple Silicon Macs).",
			inputSchema: z.object({}),
			execute: async () => {
				if (!isMacOSIntegrationSupported()) {
					return { error: "macOS only." };
				}
				if (ctx.dryRun) {
					return { dryRun: true, message: "Would read display brightness." };
				}
				const r = getDisplayBrightness();
				if (!r.ok) {
					return { ok: false, error: r.error };
				}
				return { ok: true, brightness: r.brightness, percent: r.percent };
			},
		}),

		macDisplaySetBrightness: tool({
			description:
				"macOS only. Set display brightness level (0-100). May not be supported on all hardware configurations.",
			inputSchema: z.object({
				level: z.number().min(0).max(100).describe("Brightness level 0-100"),
			}),
			execute: async ({ level }) => {
				if (!isMacOSIntegrationSupported()) {
					return { error: "macOS only." };
				}
				if (ctx.dryRun) {
					ctx.appliedActions.push(
						`[DRY RUN] Would set display brightness to ${level}.`,
					);
					return { dryRun: true };
				}
				const r = setDisplayBrightness(level);
				if (r.ok) {
					ctx.appliedActions.push(`Display brightness set to ${level}.`);
				}
				return { ok: r.ok, ...(r.ok ? { level } : { error: r.error }) };
			},
		}),

		macClipboardRead: tool({
			description:
				"macOS only. Read the current text content of the system clipboard.",
			inputSchema: z.object({}),
			execute: async () => {
				if (!isMacOSIntegrationSupported()) {
					return { error: "macOS only." };
				}
				if (ctx.dryRun) {
					return { dryRun: true, message: "Would read clipboard." };
				}
				const r = readClipboard();
				if (!r.ok) {
					return { ok: false, error: r.error };
				}
				return { ok: true, text: r.text, hasContent: r.hasContent };
			},
		}),

		macClipboardWrite: tool({
			description:
				"macOS only. Write text to the system clipboard, replacing any current content.",
			inputSchema: z.object({
				text: z.string().describe("Text to write to clipboard"),
			}),
			execute: async ({ text }) => {
				if (!isMacOSIntegrationSupported()) {
					return { error: "macOS only." };
				}
				if (ctx.dryRun) {
					ctx.appliedActions.push("[DRY RUN] Would write text to clipboard.");
					return { dryRun: true };
				}
				const r = writeClipboard(text);
				if (r.ok) {
					ctx.appliedActions.push("Copied text to clipboard.");
				}
				return { ok: r.ok, ...(r.ok ? {} : { error: r.error }) };
			},
		}),

		macSystemInfo: tool({
			description:
				"macOS only. Get system information: OS version, hardware model, hostname, uptime, processor count, physical memory, and Apple Silicon status.",
			inputSchema: z.object({}),
			execute: async () => {
				if (!isMacOSIntegrationSupported()) {
					return { error: "macOS only." };
				}
				if (ctx.dryRun) {
					return { dryRun: true, message: "Would read system info." };
				}
				const r = getSystemInfo();
				if (!r.ok) {
					return { ok: false, error: r.error };
				}
				return { ok: true, ...r.data };
			},
		}),

		macNotificationsPeek: tool({
			description:
				"macOS only. Notification Center is not exposed reliably via CLI or native APIs. This tool explicitly states limitation (no unread fetch).",
			inputSchema: z.object({}),
			execute: async () => {
				return {
					supported: false,
					message:
						"Toby cannot list Notification Center items via a stable public API. Deferred by design.",
				};
			},
		}),
	};
}
