import {
	ensurePluginDataDir,
	readConfig,
	readCredentials,
} from "../../config/index";
import { daemonLog } from "../../logging/daemon-log";
import { forwardPluginStderr } from "./adapter";
import { pluginEventsPollAsync } from "./client";
import { discoverPluginBinaries } from "./discovery";
import { parseManifest } from "./manifest";
import type {
	DiscoveredPlugin,
	PluginInvocationTarget,
	PluginManifest,
} from "./protocol";
import { resolvePluginTarget } from "./runtime";

interface PollablePlugin {
	readonly name: string;
	readonly target: PluginInvocationTarget;
	readonly intervalMs: number;
	readonly dataDir: string;
}

interface PollerOptions {
	readonly signal: AbortSignal;
	readonly onError?: (name: string, message: string) => void;
}

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.resolve();
	return new Promise<void>((resolve) => {
		const t = setTimeout(resolve, ms);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(t);
				resolve();
			},
			{ once: true },
		);
	});
}

/** Read the manifest for a bun-package plugin to extract poll config. */
function getPollIntervalFromManifest(
	discovered: DiscoveredPlugin,
): number | null {
	if (discovered.kind !== "bun-package") return null;
	const result = parseManifest(discovered.directoryPath);
	if (!result.ok) return null;
	const manifest: PluginManifest = result.manifest;
	const intervalSeconds = manifest.events?.poll?.intervalSeconds;
	if (typeof intervalSeconds !== "number" || intervalSeconds < 1) return null;
	return Math.floor(intervalSeconds);
}

/** Check whether a plugin is connected by reading config/credentials state. */
function isPluginConnected(name: string): boolean {
	const creds = readCredentials();
	const configBlock = creds.integrations?.[name];
	if (!configBlock || typeof configBlock !== "object") return false;
	const hasKeys = Object.keys(configBlock).length > 0;

	const config = readConfig();
	const stateBlock = config.integrations?.[name];
	const connectedAt =
		stateBlock && typeof stateBlock === "object"
			? (stateBlock as Record<string, unknown>).connectedAt
			: undefined;

	return Boolean(connectedAt) || hasKeys;
}

/** Discover plugins that declare poll events in their manifest. */
export function discoverPollablePlugins(): PollablePlugin[] {
	const pollable: PollablePlugin[] = [];
	for (const discovered of discoverPluginBinaries()) {
		const intervalSeconds = getPollIntervalFromManifest(discovered);
		if (!intervalSeconds) continue;

		let target: PluginInvocationTarget;
		try {
			target = resolvePluginTarget(discovered);
		} catch {
			continue;
		}

		const name = discovered.binaryName.replace(/^toby-plugin-/, "");
		const dataDir = ensurePluginDataDir(name);
		pollable.push({
			name,
			target,
			intervalMs: intervalSeconds * 1000,
			dataDir,
		});
	}
	return pollable;
}

async function pollOnce(
	plugin: PollablePlugin,
	onError?: (name: string, message: string) => void,
): Promise<void> {
	if (!isPluginConnected(plugin.name)) return;

	const creds = readCredentials();
	const config = readConfig();
	const pluginConfig = creds.integrations?.[plugin.name] ?? {};
	const pluginState =
		(config.integrations?.[plugin.name] as Record<string, unknown>) ?? {};

	const result = await pluginEventsPollAsync(plugin.target, {
		config: pluginConfig,
		state: pluginState,
		paths: { dataDir: plugin.dataDir },
	});
	forwardPluginStderr(plugin.name, result.stderr);

	if (!result.ok) {
		daemonLog("warn", "plugin-poller", "plugin_poll_failed", {
			plugin: plugin.name,
			message: result.error,
		});
		onError?.(plugin.name, result.error);
		return;
	}

	if (!result.data.ok) {
		daemonLog("warn", "plugin-poller", "plugin_poll_error", {
			plugin: plugin.name,
			error: result.data.error,
		});
		return;
	}

	const newCount = result.data.newCount;
	const summary = result.data.summary;
	daemonLog("info", "plugin-poller", "plugin_poll_complete", {
		plugin: plugin.name,
		newCount,
		summary,
	});
}

async function runPluginPollLoop(
	plugin: PollablePlugin,
	signal: AbortSignal,
	onError?: (name: string, message: string) => void,
): Promise<void> {
	while (!signal.aborted) {
		try {
			await pollOnce(plugin, onError);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			daemonLog("warn", "plugin-poller", "plugin_poll_exception", {
				plugin: plugin.name,
				message,
			});
			onError?.(plugin.name, message);
		}
		if (signal.aborted) return;
		await sleepWithAbort(plugin.intervalMs, signal);
	}
}

/**
 * Start the plugin polling loop for all discovered plugins that declare
 * `events.poll.intervalSeconds` in their manifest. Returns a promise that
 * resolves when all poll loops have stopped (after signal abort).
 */
export async function startPluginPollingLoop(
	options: PollerOptions,
): Promise<void> {
	const pollable = discoverPollablePlugins();
	if (pollable.length === 0) {
		// Nothing to poll — wait for abort signal so Promise.all doesn't return immediately.
		await new Promise<void>((resolve) => {
			options.signal.addEventListener("abort", () => resolve(), {
				once: true,
			});
		});
		return;
	}

	daemonLog("info", "plugin-poller", "plugin_poller_started", {
		plugins: pollable.map((p) => p.name),
	});

	const tasks = pollable.map((plugin) =>
		runPluginPollLoop(plugin, options.signal, options.onError),
	);

	await Promise.all(tasks);

	daemonLog("info", "plugin-poller", "plugin_poller_stopped", {});
}
