import { getDefaultProvider } from "../../config/index";
import { getIntegrationModule } from "../../integrations/index";
import type { IntegrationModule } from "../../integrations/types";
import { ALL_PROVIDER_CATEGORIES } from "../../integrations/types";

export const CHAT_CONNECTION_PROBE_TIMEOUT_MS = 5_000;

export interface ConnectionProbeResult {
	readonly name: string;
	readonly displayName: string;
	readonly ok: boolean;
	readonly timedOut: boolean;
}

export type ConnectionProbeProgress =
	| {
			readonly type: "start";
			readonly module: IntegrationModule;
	  }
	| {
			readonly type: "result";
			readonly module: IntegrationModule;
			readonly result: ConnectionProbeResult;
	  }
	| {
			readonly type: "complete";
			readonly results: readonly ConnectionProbeResult[];
	  };

interface RunConnectionProbesOptions {
	readonly timeoutMs?: number;
	readonly onProgress?: (
		event: ConnectionProbeProgress,
	) => void | Promise<void>;
}

class ConnectionProbeTimeoutError extends Error {
	constructor(displayName: string, timeoutMs: number) {
		super(`${displayName} connection check timed out after ${timeoutMs}ms.`);
		this.name = "ConnectionProbeTimeoutError";
	}
}

export function collectModulesForConnectionProbe(
	selected: readonly IntegrationModule[],
): IntegrationModule[] {
	const byName = new Map<string, IntegrationModule>();
	for (const cat of ALL_PROVIDER_CATEGORIES) {
		const defaultName = getDefaultProvider(cat);
		if (!defaultName) continue;
		const mod = getIntegrationModule(defaultName);
		if (mod) {
			byName.set(mod.name, mod);
		}
	}
	for (const mod of selected) {
		byName.set(mod.name, mod);
	}
	return [...byName.values()];
}

async function withTimeout<T>(
	promise: Promise<T>,
	displayName: string,
	timeoutMs: number,
): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timeout = setTimeout(
					() => reject(new ConnectionProbeTimeoutError(displayName, timeoutMs)),
					timeoutMs,
				);
			}),
		]);
	} finally {
		if (timeout) {
			clearTimeout(timeout);
		}
	}
}

export async function runConnectionProbes(
	modules: readonly IntegrationModule[],
	options: RunConnectionProbesOptions = {},
): Promise<ConnectionProbeResult[]> {
	const timeoutMs = options.timeoutMs ?? CHAT_CONNECTION_PROBE_TIMEOUT_MS;
	const report = async (event: ConnectionProbeProgress): Promise<void> => {
		await options.onProgress?.(event);
	};

	const results = await Promise.all(
		modules.map(async (module) => {
			await report({ type: "start", module });
			let ok = false;
			let timedOut = false;
			try {
				const health = await withTimeout(
					module.testConnection({ validateTools: false }),
					module.displayName,
					timeoutMs,
				);
				ok = health.ok;
			} catch (error) {
				timedOut = error instanceof ConnectionProbeTimeoutError;
				ok = false;
			}
			const result: ConnectionProbeResult = {
				name: module.name,
				displayName: module.displayName,
				ok,
				timedOut,
			};
			await report({ type: "result", module, result });
			return result;
		}),
	);
	await report({ type: "complete", results });
	return results;
}
