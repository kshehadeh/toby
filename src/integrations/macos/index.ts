import fs from "node:fs";
import chalk from "chalk";
import { formatPersonaAiLabel } from "../../ai/model-factory";
import { runSharedChatTurn } from "../../chat-pipeline/run-turn";
import type { CredentialsFile } from "../../config/index";
import { readConfig, writeConfig } from "../../config/index";
import type {
	ChatRunOptions,
	CredentialFieldDescriptor,
	IntegrationModule,
	IntegrationToolHealth,
	TestConnectionOptions,
} from "../types";
import { isMacOSIntegrationSupported, smokeTestMacOSSubsystem } from "./client";
import {
	buildMacOSChatSystemMessage,
	buildMacOSChatUserMessage,
} from "./prompts/chat";
import { execSystemHelper } from "./system-helper";
import { type MacOSToolContext, createMacOSTools } from "./tools";

function isMacOSConnected(): boolean {
	return Boolean(readConfig().integrations?.macos?.connectedAt);
}

const macosLifecycle = {
	name: "macos" as const,
	displayName: "macOS",
	description:
		"Control this Mac locally — Wi‑Fi, Bluetooth, battery info, audio outputs, display brightness, volume, clipboard, shortcuts, low power probes",

	async connect(): Promise<void> {
		if (!isMacOSIntegrationSupported()) {
			console.log(
				chalk.yellow("macOS integration is only available on macOS."),
			);
			return;
		}

		const config = readConfig();
		if (config.integrations?.macos?.connectedAt) {
			console.log(
				chalk.yellow(
					"macOS integration is already connected. Disconnect first to reconnect.",
				),
			);
			return;
		}

		console.log(chalk.cyan("Connecting macOS system integration…"));
		try {
			await smokeTestMacOSSubsystem();
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			throw new Error(`macOS subsystem check failed: ${msg}`);
		}

		const toolChecks = await validateMacOSSubtools();
		for (const c of toolChecks) {
			const prefix = c.ok ? chalk.green("  ✓") : chalk.dim("  ○");
			console.log(`${prefix} ${c.tool}: ${c.details}`);
		}

		config.integrations = {
			...(config.integrations ?? {}),
			macos: {
				...(config.integrations?.macos ?? {}),
				connectedAt: new Date().toISOString(),
			},
		};
		writeConfig(config);
		console.log(chalk.green("macOS integration connected."));
	},

	async isConnected(): Promise<boolean> {
		return isMacOSConnected();
	},

	async testConnection(options?: TestConnectionOptions) {
		if (!isMacOSIntegrationSupported()) {
			return {
				ok: false,
				details: "macOS integration is only usable on Darwin.",
			};
		}
		if (!(await macosLifecycle.isConnected())) {
			return {
				ok: false,
				details: "Not connected. Run `toby connect macos` on this Mac first.",
			};
		}
		if (!options?.validateTools) {
			return {
				ok: true,
				details:
					"macOS integration is configured; full subsystem probes skipped.",
			};
		}
		try {
			await smokeTestMacOSSubsystem();
			const checks = await validateMacOSSubtools();
			const criticalFail = checks.some(
				(c) =>
					!c.ok &&
					(c.tool.includes("toby-macos wifi") ||
						c.tool.includes("toby-macos battery")),
			);
			return {
				ok: !criticalFail,
				details: criticalFail
					? "toby-macos wifi/battery probe failed — Wi‑Fi or battery tooling may break."
					: "Subsystem probes reachable.",
				tools: checks,
			};
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			return { ok: false, details: `macOS probe failed: ${msg}` };
		}
	},

	async disconnect(): Promise<void> {
		const cfg = readConfig();
		if (!cfg.integrations?.macos) {
			console.log(chalk.yellow("macOS integration was not connected."));
			return;
		}
		const next = { ...cfg.integrations };
		Reflect.deleteProperty(next, "macos");
		cfg.integrations = next;
		writeConfig(cfg);
		console.log(chalk.green("macOS integration disconnected."));
	},
};

function getCredentialDescriptors(): CredentialFieldDescriptor[] {
	const opt: Pick<CredentialFieldDescriptor, "masked"> = { masked: false };
	return [
		{
			key: "macos.wifiPreferredDevice",
			label: "Wi‑Fi Device (optional, e.g. en0)",
			...opt,
		},
		{
			key: "macos.switchAudioSourcePath",
			label:
				"SwitchAudioSource absolute path (optional, e.g. /opt/homebrew/bin/SwitchAudioSource)",
			...opt,
		},
		{
			key: "macos.shortcutFocusOn",
			label: "Shortcut — Focus / DND ON (exact Shortcut name)",
			...opt,
		},
		{
			key: "macos.shortcutFocusOff",
			label: "Shortcut — Focus / DND OFF",
			...opt,
		},
		{
			key: "macos.shortcutBluetoothOn",
			label: "Shortcut — Bluetooth ON",
			...opt,
		},
		{
			key: "macos.shortcutBluetoothOff",
			label: "Shortcut — Bluetooth OFF",
			...opt,
		},
		{
			key: "macos.shortcutLowPowerOn",
			label: "Shortcut — Low Power Mode ON",
			...opt,
		},
		{
			key: "macos.shortcutLowPowerOff",
			label: "Shortcut — Low Power Mode OFF",
			...opt,
		},
		{
			key: "macos.notes",
			label: "Notes (optional)",
			multiline: true,
			masked: false,
		},
	];
}

function seedCredentialValues(creds: CredentialsFile): Record<string, string> {
	const m = creds.integrations?.macos ?? {};
	const def = "";
	return {
		"macos.wifiPreferredDevice": m.wifiPreferredDevice ?? def,
		"macos.switchAudioSourcePath": m.switchAudioSourcePath ?? def,
		"macos.shortcutFocusOn": m.shortcutFocusOn ?? def,
		"macos.shortcutFocusOff": m.shortcutFocusOff ?? def,
		"macos.shortcutBluetoothOn": m.shortcutBluetoothOn ?? def,
		"macos.shortcutBluetoothOff": m.shortcutBluetoothOff ?? def,
		"macos.shortcutLowPowerOn": m.shortcutLowPowerOn ?? def,
		"macos.shortcutLowPowerOff": m.shortcutLowPowerOff ?? def,
		"macos.notes":
			m.notes?.trim() ||
			"Optional local notes. Shortcuts referenced above must exist in Shortcuts.app.",
	};
}

function mergeCredentialsPatch(
	values: Record<string, string>,
	previous: CredentialsFile,
): Partial<CredentialsFile> {
	const prev = previous.integrations?.macos ?? {};
	const empty = "";

	return {
		integrations: {
			...(previous.integrations ?? {}),
			macos: {
				...prev,
				connectedAt: prev.connectedAt,
				wifiPreferredDevice:
					values["macos.wifiPreferredDevice"]?.trim() ??
					prev.wifiPreferredDevice ??
					empty,
				switchAudioSourcePath:
					values["macos.switchAudioSourcePath"]?.trim() ??
					prev.switchAudioSourcePath ??
					empty,
				shortcutFocusOn:
					values["macos.shortcutFocusOn"]?.trim() ??
					prev.shortcutFocusOn ??
					empty,
				shortcutFocusOff:
					values["macos.shortcutFocusOff"]?.trim() ??
					prev.shortcutFocusOff ??
					empty,
				shortcutBluetoothOn:
					values["macos.shortcutBluetoothOn"]?.trim() ??
					prev.shortcutBluetoothOn ??
					empty,
				shortcutBluetoothOff:
					values["macos.shortcutBluetoothOff"]?.trim() ??
					prev.shortcutBluetoothOff ??
					empty,
				shortcutLowPowerOn:
					values["macos.shortcutLowPowerOn"]?.trim() ??
					prev.shortcutLowPowerOn ??
					empty,
				shortcutLowPowerOff:
					values["macos.shortcutLowPowerOff"]?.trim() ??
					prev.shortcutLowPowerOff ??
					empty,
				notes:
					values["macos.notes"] ??
					prev.notes ??
					seedCredentialValues(previous)["macos.notes"],
			},
		},
	};
}

async function validateMacOSSubtools(): Promise<IntegrationToolHealth[]> {
	const checks: IntegrationToolHealth[] = [];
	const wifiResult = execSystemHelper("wifi", "status");
	checks.push({
		tool: "toby-macos wifi status",
		ok: wifiResult.ok,
		details: wifiResult.ok
			? "reachable"
			: (wifiResult.error || "failed").slice(0, 200),
	});
	const batteryResult = execSystemHelper("battery", "status");
	checks.push({
		tool: "toby-macos battery status",
		ok: batteryResult.ok,
		details: batteryResult.ok
			? "readable"
			: (batteryResult.error || "failed").slice(0, 200),
	});
	const hasShortcutsCli = fs.existsSync("/usr/bin/shortcuts");
	checks.push({
		tool: "shortcuts binary",
		ok: hasShortcutsCli,
		details: hasShortcutsCli ? "/usr/bin/shortcuts exists" : "missing",
	});
	return checks;
}

const MACOS_MUTATING_TOOLS = new Set([
	"macWifiSetPower",
	"macAudioSwitchOutput",
	"macAudioSetVolume",
	"macAudioSetMute",
	"macBluetoothSetPower",
	"macLowPowerModeSet",
	"macShortcutsRun",
	"macDisplaySetBrightness",
	"macClipboardWrite",
]);

async function chat(options: ChatRunOptions): Promise<void> {
	const persona = options.personaForModel;
	const dryRun = options.dryRun;
	const maxResults = options.maxResults;

	console.log(chalk.cyan(`macOS chat (persona "${persona.name}")…`));
	console.log(chalk.dim(`  AI: ${formatPersonaAiLabel(persona)}`));
	if (dryRun) {
		console.log(chalk.yellow("  (dry run - changes will not be applied)"));
	}
	console.log(chalk.dim(`  Goal: ${options.prompt}`));
	console.log();

	if (!isMacOSIntegrationSupported()) {
		console.log(chalk.red("macOS chat requires macOS."));
		return;
	}

	const messages = [
		buildMacOSChatSystemMessage(persona),
		await buildMacOSChatUserMessage(options.prompt),
	];

	console.log(chalk.cyan("Running assistant…\n"));

	const result = await runSharedChatTurn([macosIntegrationModule], messages, {
		persona,
		dryRun,
		maxResults,
	});

	for (const a of result.appliedActions) {
		console.log(chalk.green(`+ ${a}`));
	}

	const mutating = result.toolCalls.filter((tc) =>
		MACOS_MUTATING_TOOLS.has(tc.name),
	);
	const confirmed = result.appliedActions.length > 0;
	if (!confirmed && mutating.length > 0) {
		console.log(
			chalk.yellow(
				"! Mutating macOS tools ran but no persisted action logged (inspect tool errors above).",
			),
		);
	}

	for (const tc of result.toolCalls) {
		console.log(chalk.blue(`-> ${tc.name}(${JSON.stringify(tc.args)})`));
	}

	if (result.text?.trim()) {
		console.log();
		console.log(chalk.bold("Assistant"));
		console.log(result.text.trim());
	}
	console.log();
	console.log(chalk.green("Done."));
}

export const macosIntegrationModule: IntegrationModule = {
	...macosLifecycle,
	capabilities: ["chat"],
	resources: [
		"wifi",
		"bluetooth",
		"battery",
		"audio",
		"focus",
		"powermode",
		"display",
		"clipboard",
	],
	chatReadiness: async () => {
		if (!isMacOSIntegrationSupported()) {
			return { ok: false, hint: "macOS integration runs only on macOS hosts." };
		}
		if (await macosLifecycle.isConnected()) return { ok: true };
		return {
			ok: false,
			hint: "Run `toby connect macos` on this Mac to enable macOS automation tools.",
		};
	},
	createChatTools: ({ dryRun, maxResults }) => {
		void maxResults;
		const ctx: MacOSToolContext = { dryRun, appliedActions: [] };
		return {
			tools: createMacOSTools(ctx),
			appliedActions: ctx.appliedActions,
		};
	},
	chatModelPrep: {
		systemPromptSection: `### Local macOS
Use mac* tools — Wi‑Fi scan & power, Bluetooth, battery info, audio list/switch/volume/mute, display brightness, clipboard read/write, pmset Low Power probes, Shortcut runner, unsupported notifications ack.

Audio rule: **macAudioListOutputs** returns both outputs and inputs. When the user asks to switch/change/set the output device, use **macAudioSwitchOutput** once the target is known. Use **macAudioListOutputs** only to discover exact names; do not stop after listing if there is a clear output match.`,
		async buildSingleSessionMessages(persona, userPrompt) {
			return [
				buildMacOSChatSystemMessage(persona),
				await buildMacOSChatUserMessage(userPrompt),
			];
		},
		async buildMultiUserContent(userPrompt) {
			return `## Local macOS
Use mac tools for system changes on **this Mac** (Darwin only).
User mixed prompt:
${userPrompt || "(no additional text)"}`;
		},
	},
	getCredentialDescriptors,
	seedCredentialValues,
	mergeCredentialsPatch,
	chat,
};
