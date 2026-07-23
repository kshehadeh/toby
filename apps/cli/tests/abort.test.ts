import { describe, expect, it } from "bun:test";
import {
	createChatTurnAbortError,
	isAbortError,
	throwIfAborted,
} from "@toby/core/abort";

describe("abort helpers", () => {
	it("isAbortError detects AbortError by name", () => {
		expect(isAbortError(createChatTurnAbortError())).toBe(true);
		const dom = new DOMException("aborted", "AbortError");
		expect(isAbortError(dom)).toBe(true);
	});

	it("isAbortError rejects unrelated errors", () => {
		expect(isAbortError(new Error("network"))).toBe(false);
		expect(isAbortError(null)).toBe(false);
	});

	it("throwIfAborted throws when signal is aborted", () => {
		const ac = new AbortController();
		ac.abort();
		expect(() => throwIfAborted(ac.signal)).toThrow(
			expect.objectContaining({ name: "AbortError" }),
		);
	});

	it("throwIfAborted is a no-op for active signals", () => {
		const ac = new AbortController();
		expect(() => throwIfAborted(ac.signal)).not.toThrow();
		expect(() => throwIfAborted(undefined)).not.toThrow();
	});
});
