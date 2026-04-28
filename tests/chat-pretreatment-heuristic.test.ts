import { describe, expect, it, vi } from "vitest";
import type { CoreMessage } from "../src/ai/chat";
import {
	isPretreatmentDisabled,
	shouldPretreat,
	wrapUserPromptWithPretreatment,
} from "../src/ai/pretreatment";

const mockedStore = vi.hoisted(() => ({
	getPretreatmentCache: vi.fn<(promptKey: string) => unknown | null>(),
	setPretreatmentCache: vi.fn<(promptKey: string, spec: unknown) => void>(),
}));

vi.mock("../src/ui/chat/session-store", () => mockedStore);

describe("shouldPretreat", () => {
	it("returns true on first turn when not disabled", () => {
		expect(shouldPretreat([], "hello world", true)).toBe(true);
		expect(shouldPretreat([], "  ", true)).toBe(false);
	});

	it("returns false when pretreatment is disabled", () => {
		const prev = process.env.TOBY_DISABLE_PRETREATMENT;
		process.env.TOBY_DISABLE_PRETREATMENT = "1";
		try {
			expect(shouldPretreat([], "hello", true)).toBe(false);
		} finally {
			if (prev === undefined) {
				process.env.TOBY_DISABLE_PRETREATMENT = undefined;
			} else {
				process.env.TOBY_DISABLE_PRETREATMENT = prev;
			}
		}
	});

	it("returns false on later turn when message is long and unambiguous", () => {
		const long =
			"Please list my open Todoist tasks sorted by due date and exclude completed items.";
		expect(shouldPretreat([], long, false)).toBe(false);
	});

	it("returns true on later turn for very short follow-ups", () => {
		expect(shouldPretreat([], "ok", false)).toBe(true);
	});

	it("returns true for pronoun-heavy text without assistant after last user", () => {
		const msgs: CoreMessage[] = [
			{ role: "system", content: "sys" },
			{ role: "user", content: "first" },
		];
		expect(shouldPretreat(msgs, "Do the same for that one", false)).toBe(true);
	});

	it("returns false for pronoun-heavy text when the thread ends with an assistant reply", () => {
		const msgs: CoreMessage[] = [
			{ role: "user", content: "first" },
			{ role: "assistant", content: "done" },
			{ role: "user", content: "second" },
			{ role: "assistant", content: "ok" },
		];
		expect(shouldPretreat(msgs, "Do the same for that one", false)).toBe(false);
	});

	it("returns true for multi-clause follow-ups", () => {
		const msgs: CoreMessage[] = [{ role: "user", content: "prior" }];
		expect(
			shouldPretreat(
				msgs,
				"Archive the thread and then mark it read; also snooze for tomorrow",
				false,
			),
		).toBe(true);
	});
});

describe("wrapUserPromptWithPretreatment", () => {
	it("skips the model call when pretreatment is disabled", async () => {
		const prev = process.env.TOBY_DISABLE_PRETREATMENT;
		process.env.TOBY_DISABLE_PRETREATMENT = "1";
		try {
			const r = await wrapUserPromptWithPretreatment({
				priorMessages: [],
				rawUserText: "hello",
				integrationLabels: "gmail",
				isFirstTurn: true,
			});
			expect(r.content).toBe("hello");
			expect(r.spec).toBeNull();
		} finally {
			if (prev === undefined) {
				process.env.TOBY_DISABLE_PRETREATMENT = undefined;
			} else {
				process.env.TOBY_DISABLE_PRETREATMENT = prev;
			}
		}
	});

	it("uses cached pretreatment when available (no OpenAI token needed)", async () => {
		const g = globalThis as unknown as { Bun?: unknown };
		const prevBun = g.Bun;
		g.Bun = {}; // enable cache path

		try {
			mockedStore.getPretreatmentCache.mockReturnValue({
				goal: "Do a thing",
				mustDo: [],
				mustNotDo: [],
				assumptions: [],
				openQuestions: [],
				relevantIntegrations: [],
			});

			const r = await wrapUserPromptWithPretreatment({
				priorMessages: [],
				rawUserText: "Hello",
				integrationLabels: "",
				isFirstTurn: true,
			});

			expect(mockedStore.getPretreatmentCache).toHaveBeenCalledTimes(1);
			expect(mockedStore.setPretreatmentCache).not.toHaveBeenCalled();
			expect(r.content).toContain("User request (verbatim):");
			expect(r.content).toContain(JSON.stringify("Hello"));
		} finally {
			mockedStore.getPretreatmentCache.mockReset();
			mockedStore.setPretreatmentCache.mockReset();
			if (prevBun === undefined) {
				(g as { Bun?: unknown }).Bun = undefined;
			} else {
				g.Bun = prevBun;
			}
		}
	});
});

describe("isPretreatmentDisabled", () => {
	it("reflects TOBY_DISABLE_PRETREATMENT", () => {
		const prev = process.env.TOBY_DISABLE_PRETREATMENT;
		process.env.TOBY_DISABLE_PRETREATMENT = "1";
		try {
			expect(isPretreatmentDisabled()).toBe(true);
		} finally {
			if (prev === undefined) {
				process.env.TOBY_DISABLE_PRETREATMENT = undefined;
			} else {
				process.env.TOBY_DISABLE_PRETREATMENT = prev;
			}
		}
	});
});
