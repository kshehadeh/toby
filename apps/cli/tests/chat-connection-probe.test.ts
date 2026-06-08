import type { IntegrationModule } from "@toby/core/integrations/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type ConnectionProbeProgress,
	countIntegrationConnectionStatuses,
	runConnectionProbes,
} from "../src/ui/chat/connection-probe";

function mockModule(
	name: string,
	options: {
		readonly isConnected?: IntegrationModule["isConnected"];
		readonly testConnection?: IntegrationModule["testConnection"];
	} = {},
): IntegrationModule {
	return {
		name,
		displayName: name,
		description: `${name} integration`,
		capabilities: ["chat"],
		connect: async () => {},
		isConnected: options.isConnected ?? (async () => true),
		testConnection:
			options.testConnection ??
			(async () => ({ ok: true, details: "ok" })),
		disconnect: async () => {},
		getCredentialDescriptors: () => [],
		seedCredentialValues: () => ({}),
		mergeCredentialsPatch: () => ({}),
		chat: async () => {},
	};
}

describe("runConnectionProbes", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("uses isConnected for connection state and testConnection for health", async () => {
		const testConnection = vi.fn(async (options) => ({
			ok: options?.validateTools === false,
			details: "ok",
		}));
		const mod = mockModule("tasks", { testConnection });

		const results = await runConnectionProbes([mod]);

		expect(testConnection).toHaveBeenCalledWith({ validateTools: false });
		expect(results).toEqual([
			{
				name: "tasks",
				displayName: "tasks",
				connected: true,
				healthy: true,
				timedOut: false,
			},
		]);
	});

	it("marks configured integrations as connected even when health checks fail", async () => {
		const mod = mockModule("slack", {
			isConnected: async () => true,
			testConnection: async () => ({
				ok: false,
				details: "Connected, but Slack API check failed: token_expired",
			}),
		});

		const results = await runConnectionProbes([mod]);

		expect(results).toEqual([
			{
				name: "slack",
				displayName: "slack",
				connected: true,
				healthy: false,
				timedOut: false,
			},
		]);
	});

	it("counts connected and disconnected modules from probe status map", () => {
		const modules = [
			{ name: "a" },
			{ name: "b" },
			{ name: "c" },
		] as const;
		expect(
			countIntegrationConnectionStatuses(modules, {
				a: true,
				b: false,
				c: null,
			}),
		).toEqual({ connected: 1, disconnected: 1 });
	});

	it("times out a slow health check without marking the integration disconnected", async () => {
		vi.useFakeTimers();
		const slow = mockModule("slow", {
			isConnected: async () => true,
			testConnection: () => new Promise(() => {}),
		});
		const fast = mockModule("fast", {
			testConnection: async () => ({ ok: true, details: "ok" }),
		});
		const events: ConnectionProbeProgress[] = [];

		const run = runConnectionProbes([slow, fast], {
			timeoutMs: 50,
			onProgress: (event) => {
				events.push(event);
			},
		});
		await vi.advanceTimersByTimeAsync(50);
		const results = await run;

		expect(results).toEqual([
			{
				name: "slow",
				displayName: "slow",
				connected: true,
				healthy: false,
				timedOut: true,
			},
			{
				name: "fast",
				displayName: "fast",
				connected: true,
				healthy: true,
				timedOut: false,
			},
		]);
		expect(events.filter((event) => event.type === "start")).toHaveLength(2);
		expect(events.filter((event) => event.type === "result")).toHaveLength(2);
		expect(events.at(-1)?.type).toBe("complete");
	});
});
