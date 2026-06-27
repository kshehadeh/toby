import { afterEach, describe, expect, it, jest, mock } from "bun:test";
import { createSlackStatusReporter } from "../../plugin-slack/src/status-reporter";

async function waitFor(assertion: () => void, timeoutMs = 500): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastError: Error | undefined;
	while (Date.now() < deadline) {
		try {
			assertion();
			return;
		} catch (err) {
			lastError = err as Error;
			await new Promise((r) => setTimeout(r, 10));
		}
	}
	throw lastError ?? new Error("waitFor timeout");
}

describe("createSlackStatusReporter", () => {
	afterEach(() => {
		jest.useRealTimers();
		jest.restoreAllMocks();
	});

	it("lazy-posts on first update and updates in place", async () => {
		const post = mock(() => Promise.resolve({ channel: "C1", ts: "1.0" }));
		const update = mock(() => Promise.resolve(undefined));
		const del = mock(() => Promise.resolve(undefined));
		let nowMs = 0;

		const reporter = createSlackStatusReporter({
			config: {},
			channelId: "C1",
			threadTs: "root.1",
			token: "xoxb-test",
			api: { post, update, delete: del },
			now: () => nowMs,
		});

		reporter.update("⏳ _Preparing request…_");
		await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
		expect(post).toHaveBeenCalledWith({
			config: {},
			channel: "C1",
			mrkdwnLine: "⏳ _Preparing request…_",
			threadTs: "root.1",
			token: "xoxb-test",
		});

		nowMs = 2000;
		reporter.update("📧 _Calling Gmail…_");
		await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
		expect(update).toHaveBeenCalledWith({
			config: {},
			channel: "C1",
			ts: "1.0",
			mrkdwnLine: "📧 _Calling Gmail…_",
			token: "xoxb-test",
		});

		await reporter.clear();
		expect(del).toHaveBeenCalledWith({
			config: {},
			channel: "C1",
			ts: "1.0",
			token: "xoxb-test",
		});
	});

	it("throttles rapid updates and flushes the latest line", async () => {
		jest.useFakeTimers();
		const post = mock(() => Promise.resolve({ channel: "C1", ts: "1.0" }));
		const update = mock(() => Promise.resolve(undefined));
		const del = mock(() => Promise.resolve(undefined));
		let nowMs = 0;

		const reporter = createSlackStatusReporter({
			config: {},
			channelId: "C1",
			token: "xoxb-test",
			api: { post, update, delete: del },
			now: () => nowMs,
			setTimeoutFn: (fn: () => void, ms: number) => setTimeout(fn, ms),
			clearTimeoutFn: clearTimeout,
		});

		reporter.update("⏳ _Line A_");
		jest.runAllTimers();
		await Promise.resolve();
		expect(post).toHaveBeenCalledTimes(1);

		nowMs = 100;
		reporter.update("⚙️ _Line B_");
		reporter.update("📧 _Line C_");
		expect(update).not.toHaveBeenCalled();

		nowMs = 1100;
		jest.runAllTimers();
		await Promise.resolve();
		expect(update).toHaveBeenCalledTimes(1);
		expect(update).toHaveBeenLastCalledWith(
			expect.objectContaining({ mrkdwnLine: "📧 _Line C_" }),
		);

		await reporter.clear();
		expect(del).toHaveBeenCalledTimes(1);
	});

	it("dedupes identical consecutive lines", async () => {
		const post = mock(() => Promise.resolve({ channel: "C1", ts: "1.0" }));
		const update = mock(() => Promise.resolve(undefined));
		const del = mock(() => Promise.resolve(undefined));

		const reporter = createSlackStatusReporter({
			config: {},
			channelId: "C1",
			token: "xoxb-test",
			api: { post, update, delete: del },
			now: () => Date.now(),
		});

		reporter.update("⏳ _Same_");
		await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
		reporter.update("⏳ _Same_");
		await new Promise((r) => setTimeout(r, 50));
		expect(update).not.toHaveBeenCalled();
	});
});
