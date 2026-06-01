import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntegrationModule } from "../src/integrations/types";
import {
	type ConnectionProbeProgress,
	runConnectionProbes,
} from "../src/ui/chat/connection-probe";

function mockModule(
	name: string,
	testConnection: IntegrationModule["testConnection"],
): IntegrationModule {
	return {
		name,
		displayName: name,
		description: `${name} integration`,
		capabilities: ["chat"],
		connect: async () => {},
		isConnected: async () => true,
		testConnection,
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

	it("uses lightweight connection checks", async () => {
		const testConnection = vi.fn(async (options) => ({
			ok: options?.validateTools === false,
			details: "ok",
		}));
		const mod = mockModule("tasks", testConnection);

		const results = await runConnectionProbes([mod]);

		expect(testConnection).toHaveBeenCalledWith({ validateTools: false });
		expect(results).toEqual([
			{ name: "tasks", displayName: "tasks", ok: true, timedOut: false },
		]);
	});

	it("times out a slow probe without blocking other results", async () => {
		vi.useFakeTimers();
		const slow = mockModule("slow", () => new Promise(() => {}));
		const fast = mockModule("fast", async () => ({ ok: true, details: "ok" }));
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
			{ name: "slow", displayName: "slow", ok: false, timedOut: true },
			{ name: "fast", displayName: "fast", ok: true, timedOut: false },
		]);
		expect(events.filter((event) => event.type === "start")).toHaveLength(2);
		expect(events.filter((event) => event.type === "result")).toHaveLength(2);
		expect(events.at(-1)?.type).toBe("complete");
	});
});
