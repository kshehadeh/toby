import { describe, expect, it, mock } from "bun:test";
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
		const post = mock(() => Promise.resolve({ channel: "C1", ts: "1.0" }));
		const update = mock(() => Promise.resolve(undefined));
		const del = mock(() => Promise.resolve(undefined));
		let nowMs = 0;

		// Manual timer controller to avoid process-level fake timers.
		const timers = new Map<
			number,
			{ readonly fn: () => void; readonly at: number }
		>();
		let nextTimerId = 1;
		const mockSetTimeout = (fn: () => void, ms: number) => {
			const id = nextTimerId++;
			timers.set(id, { fn, at: nowMs + ms });
			return id as unknown as ReturnType<typeof setTimeout>;
		};
		const mockClearTimeout = (id: ReturnType<typeof setTimeout>) => {
			timers.delete(id as unknown as number);
		};
		const advanceTimers = (targetMs: number) => {
			for (const [id, t] of [...timers]) {
				if (t.at <= targetMs) {
					timers.delete(id);
					t.fn();
				}
			}
		};

		const reporter = createSlackStatusReporter({
			config: {},
			channelId: "C1",
			token: "xoxb-test",
			api: { post, update, delete: del },
			now: () => nowMs,
			setTimeoutFn: mockSetTimeout,
			clearTimeoutFn: mockClearTimeout,
		});

		reporter.update("⏳ _Line A_");
		// First post is immediate (no timer); wait for the async post.
		await waitFor(() => expect(post).toHaveBeenCalledTimes(1));

		nowMs = 100;
		reporter.update("⚙️ _Line B_");
		reporter.update("📧 _Line C_");
		expect(update).not.toHaveBeenCalled();

		nowMs = 1100;
		advanceTimers(nowMs);
		// After timer fires, the pending update is enqueued; wait for it.
		await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
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
