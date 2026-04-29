import { describe, expect, it, vi } from "vitest";
import { parseWatchInterval, runWithWatch } from "../src/commands/watch";

describe("parseWatchInterval", () => {
	it('parses "every hour"', () => {
		expect(parseWatchInterval("every hour")).toBe(60 * 60 * 1000);
	});

	it('parses "30m"', () => {
		expect(parseWatchInterval("30m")).toBe(30 * 60 * 1000);
	});

	it("rejects invalid input", () => {
		expect(() => parseWatchInterval("not a duration")).toThrow(
			/Invalid watch/i,
		);
	});

	it("rejects zero or negative", () => {
		expect(() => parseWatchInterval("0s")).toThrow(/greater than 0/i);
		expect(() => parseWatchInterval("-1s")).toThrow(/greater than 0/i);
	});
});
describe("runWithWatch", () => {
	it("runs immediately, then sleeps between cycles", async () => {
		const runOnce = vi.fn(async () => {});
		const sleep = vi.fn(async () => {});

		await runWithWatch({
			label: "test",
			intervalMs: 123,
			runOnce,
			sleep,
			maxCycles: 3,
		});

		expect(runOnce).toHaveBeenCalledTimes(3);
		expect(sleep).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenNthCalledWith(1, 123, expect.any(AbortSignal));
		expect(sleep).toHaveBeenNthCalledWith(2, 123, expect.any(AbortSignal));
	});

	it("logs an error and continues when a cycle throws", async () => {
		const err = new Error("boom");
		const runOnce = vi
			.fn<[], Promise<void>>()
			.mockRejectedValueOnce(err)
			.mockResolvedValueOnce(undefined);
		const sleep = vi.fn(async () => {});

		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		await runWithWatch({
			label: "test",
			intervalMs: 1,
			runOnce,
			sleep,
			maxCycles: 2,
		});

		expect(runOnce).toHaveBeenCalledTimes(2);
		expect(consoleError).toHaveBeenCalled();

		consoleError.mockRestore();
	});
});
