import { afterEach, describe, expect, it, vi } from "vitest";
import { createSlackStatusReporter } from "../src/integrations/slack/status-reporter";

describe("createSlackStatusReporter", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("lazy-posts on first update and updates in place", async () => {
		const post = vi.fn().mockResolvedValue({ channel: "C1", ts: "1.0" });
		const update = vi.fn().mockResolvedValue(undefined);
		const del = vi.fn().mockResolvedValue(undefined);
		let nowMs = 0;

		const reporter = createSlackStatusReporter({
			channelId: "C1",
			threadTs: "root.1",
			token: "xoxb-test",
			api: { post, update, delete: del },
			now: () => nowMs,
		});

		reporter.update("⏳ _Preparing request…_");
		await vi.waitFor(() => expect(post).toHaveBeenCalledOnce());
		expect(post).toHaveBeenCalledWith({
			channel: "C1",
			mrkdwnLine: "⏳ _Preparing request…_",
			threadTs: "root.1",
			token: "xoxb-test",
		});

		nowMs = 2000;
		reporter.update("📧 _Calling Gmail…_");
		await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
		expect(update).toHaveBeenCalledWith({
			channel: "C1",
			ts: "1.0",
			mrkdwnLine: "📧 _Calling Gmail…_",
			token: "xoxb-test",
		});

		await reporter.clear();
		expect(del).toHaveBeenCalledWith({
			channel: "C1",
			ts: "1.0",
			token: "xoxb-test",
		});
	});

	it("throttles rapid updates and flushes the latest line", async () => {
		vi.useFakeTimers();
		const post = vi.fn().mockResolvedValue({ channel: "C1", ts: "1.0" });
		const update = vi.fn().mockResolvedValue(undefined);
		const del = vi.fn().mockResolvedValue(undefined);
		let nowMs = 0;

		const reporter = createSlackStatusReporter({
			channelId: "C1",
			token: "xoxb-test",
			api: { post, update, delete: del },
			now: () => nowMs,
			setTimeoutFn: vi.fn((fn, ms) => setTimeout(fn, ms)),
			clearTimeoutFn: clearTimeout,
		});

		reporter.update("⏳ _Line A_");
		await vi.runAllTimersAsync();
		expect(post).toHaveBeenCalledOnce();

		nowMs = 100;
		reporter.update("⚙️ _Line B_");
		reporter.update("📧 _Line C_");
		expect(update).not.toHaveBeenCalled();

		nowMs = 1100;
		await vi.runAllTimersAsync();
		expect(update).toHaveBeenCalledOnce();
		expect(update).toHaveBeenLastCalledWith(
			expect.objectContaining({ mrkdwnLine: "📧 _Line C_" }),
		);

		await reporter.clear();
		expect(del).toHaveBeenCalledOnce();
	});

	it("dedupes identical consecutive lines", async () => {
		const post = vi.fn().mockResolvedValue({ channel: "C1", ts: "1.0" });
		const update = vi.fn().mockResolvedValue(undefined);
		const del = vi.fn().mockResolvedValue(undefined);

		const reporter = createSlackStatusReporter({
			channelId: "C1",
			api: { post, update, delete: del },
			now: () => Date.now(),
		});

		reporter.update("⏳ _Same_");
		await vi.waitFor(() => expect(post).toHaveBeenCalledOnce());
		reporter.update("⏳ _Same_");
		await new Promise((r) => setTimeout(r, 50));
		expect(update).not.toHaveBeenCalled();
	});
});
