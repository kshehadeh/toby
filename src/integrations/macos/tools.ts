import { tool } from "ai";
import { z } from "zod";
import {
	type ShortcutAction,
	bluetoothSetPower,
	getBatteryStatus,
	isMacOSIntegrationSupported,
	listAudioOutputs,
	pmsetLowPowerModeGet,
	pmsetLowPowerModeSet,
	resolvePreferredWifiInterface,
	resolveShortcutName,
	runShortcut,
	switchAudioOutput,
	wifiPowerGet,
	wifiPowerSet,
	wifiScanNearby,
} from "./client";

export interface MacOSToolContext {
	readonly dryRun: boolean;
	readonly appliedActions: string[];
}

const SHORTCUT_ACTION_ENUM = z.enum([
	"focusOn",
	"focusOff",
	"bluetoothOn",
	"bluetoothOff",
	"lowPowerOn",
	"lowPowerOff",
]);

export function createMacOSTools(ctx: MacOSToolContext) {
	return {
		macBatteryStatus: tool({
			description:
				"macOS only. Read battery / power snapshot via pmset and system_profiler (condition, charge, cycles when available).",
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
				"macOS only. Show Wi‑Fi airport power state using networksetup (-getairportpower). Discovers Wi‑Fi Device (en*) from hardware ports.",
			inputSchema: z.object({}),
			execute: async () => {
				if (!isMacOSIntegrationSupported()) {
					return { error: "macOS only." };
				}
				if (ctx.dryRun) {
					return { dryRun: true, message: "Would query Wi‑Fi power state." };
				}
				const dev = resolvePreferredWifiInterface();
				if (!dev) {
					return {
						ok: false,
						error:
							"Could not resolve Wi‑Fi hardware device. Set Configure → integrations.macos wifiPreferredDevice (e.g. en0) if auto-detect fails.",
					};
				}
				const st = wifiPowerGet(dev);
				return {
					device: dev,
					ok: st.ok,
					statusLine: st.stdout || st.stderr,
				};
			},
		}),

		macWifiScanNearby: tool({
			description:
				"macOS only. Scan nearby Wi‑Fi: prefers `airport -s` when it still works; otherwise `system_profiler SPAirPortDataType` (Sonoma 14.4+ usually needs this path). SSIDs/RSSI parsed from plaintext; `scanSource` says which succeeded. Wi‑Fi should be ON.",
			inputSchema: z.object({}),
			execute: async () => {
				if (!isMacOSIntegrationSupported()) {
					return { error: "macOS only." };
				}
				if (ctx.dryRun) {
					return {
						dryRun: true,
						message:
							"Would scan for nearby Wi‑Fi (airport and/or SPAirPortDataType).",
					};
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
							? "Parsed zero BSSIDs — see rawPreviewTail; Wi‑Fi off or empty cache."
							: undefined,
					rawPreviewTail: r.rawPreview.slice(-4500),
				};
			},
		}),

		macWifiSetPower: tool({
			description:
				"macOS only. Turn Wi‑Fi radio on/off with networksetup -setairportpower. Requires the correct en* interface (auto-detected unless configured).",
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
					return {
						ok: false,
						error:
							"No Wi‑Fi Device found — set integrations.macos.wifiPreferredDevice in Configure (example: en0).",
					};
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
						? { message: "networksetup succeeded" }
						: { error: r.stderr.trim() || "networksetup failed" }),
				};
			},
		}),

		macAudioListOutputs: tool({
			description:
				"macOS only. List audio output and input device names. Prefer exact SwitchAudioSource names (`SwitchAudioSource -a -t output/input`) when available; fallback to system_profiler SPAudioDataType.",
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
					switchAudioSourceDevices: r.switchAudioSourceDevices,
					switchAudioSourceOutputs: r.switchAudioSourceOutputs,
					switchAudioSourceInputs: r.switchAudioSourceInputs,
					hintForSwitchTool:
						r.switchAudioSourceDevices && r.switchAudioSourceDevices.length > 0
							? "These are SwitchAudioSource-compatible output names. If the user requested a target that clearly matches one, call macAudioSwitchOutput next with that exact or substring name; do not stop after listing."
							: "Use macAudioSwitchOutput with a substring matching an entry; requires SwitchAudioSource (brew install switchaudio-osx).",
				};
			},
		}),

		macAudioSwitchOutput: tool({
			description:
				"macOS only. Set default output audio device using SwitchAudioSource. Use this whenever the user asks to switch/change/set audio output and a target device name or clear substring is known. If not known, call macAudioListOutputs first, then call this tool with the selected output name.",
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
					return { dryRun: true, message: "Would invoke SwitchAudioSource." };
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
						: { error: r.stderr.trim() || "SwitchAudioSource failed" }),
				};
			},
		}),

		macBluetoothSetPower: tool({
			description:
				"macOS only. Enable/disable Bluetooth using blueutil (`brew install blueutil`). Shortcut-based toggles are preferable if blueutil unavailable.",
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
						`Bluetooth ${enabled ? "enabled" : "disabled"} via blueutil.`,
					);
				}
				return {
					ok: r.ok,
					...(r.ok
						? {}
						: { error: r.stderr.trim() || "blueutil invocation failed" }),
				};
			},
		}),

		macLowPowerModeStatus: tool({
			description:
				"macOS only. Read low power mode related lines from pmset -g custom (may omit features on desktops).",
			inputSchema: z.object({}),
			execute: async () => {
				if (!isMacOSIntegrationSupported()) {
					return { error: "macOS only." };
				}
				if (ctx.dryRun) {
					return { dryRun: true, message: "Would read pmset custom." };
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
				"macOS only. Trial: pmset -a lowpowermode 1|0 — may fail without privileges; fallback to Shortcut fields (`macShortcutsRun`).",
			inputSchema: z.object({
				enabled: z.boolean(),
			}),
			execute: async ({ enabled }) => {
				if (!isMacOSIntegrationSupported()) {
					return { error: "macOS only." };
				}
				if (ctx.dryRun) {
					ctx.appliedActions.push(
						`[DRY RUN] Would pmset lowpowermode ${enabled ? "1" : "0"}.`,
					);
					return { dryRun: true };
				}
				const r = pmsetLowPowerModeSet(enabled);
				if (r.ok) {
					ctx.appliedActions.push(
						`pmset lowpowermode → ${enabled ? "1 (on)" : "0 (off)"}.`,
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
									"If permission denied configure Shortcuts (`macShortcutsRun`) or run manually with privileges.",
							}),
				};
			},
		}),

		macShortcutsRun: tool({
			description:
				"macOS only. Run `/usr/bin/shortcuts run` configured in Toby Configure (`macos.shortcut*` fields): focus/bluetooth/low-power toggles. Action maps to Shortcut name configured by user.",
			inputSchema: z.object({
				action: SHORTCUT_ACTION_ENUM.describe(
					"Configured shortcut preset (requires matching field in Toby Configure)",
				),
			}),
			execute: async ({ action }: { readonly action: ShortcutAction }) => {
				if (!isMacOSIntegrationSupported()) {
					return { error: "macOS only." };
				}
				const shortcut = resolveShortcutName(action);
				if (!shortcut) {
					return {
						ok: false,
						error: `No shortcut name configured for action "${action}". Open Configure → macOS shortcut fields.`,
					};
				}
				if (ctx.dryRun) {
					ctx.appliedActions.push(
						`[DRY RUN] shortcuts run "${shortcut}" (${action})`,
					);
					return {
						dryRun: true,
						shortcutName: shortcut,
						action,
					};
				}
				const r = runShortcut(shortcut);
				if (r.ok) {
					ctx.appliedActions.push(`Shortcuts ran "${shortcut}" (${action}).`);
				}
				return {
					ok: r.ok,
					shortcutName: shortcut,
					action,
					...(r.ok
						? { stdoutTail: r.stdout.trim().slice(-2000) }
						: { error: r.stderr.trim() || "shortcuts CLI failed" }),
				};
			},
		}),

		macNotificationsPeek: tool({
			description:
				"macOS only. Notification Center is not exposed reliably via CLI. This tool explicitly states limitation (no unread fetch). Prefer OS UI / future helper app.",
			inputSchema: z.object({}),
			execute: async () => {
				return {
					supported: false,
					message:
						"Toby cannot list Notification Center items via a stable public CLI. Deferred by design.",
				};
			},
		}),
	};
}
