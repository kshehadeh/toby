import { describe, expect, it, vi } from "vitest";
import type { CoreMessage } from "../src/ai/chat";
import {
	isFirstTurnPretreatmentEnabled,
	isPretreatmentDisabled,
	shouldPretreat,
	wrapUserPromptWithPretreatment,
} from "../src/ai/pretreatment";
import * as sessionStore from "../src/ui/chat/session-store";

describe("shouldPretreat", () => {
	it("returns false on first turn by default", () => {
		const prev = process.env.TOBY_PRETREAT_FIRST_TURN;
		process.env.TOBY_PRETREAT_FIRST_TURN = undefined;
		try {
			expect(shouldPretreat([], "hello world", true)).toBe(false);
			expect(shouldPretreat([], "  ", true)).toBe(false);
		} finally {
			if (prev !== undefined) {
				process.env.TOBY_PRETREAT_FIRST_TURN = prev;
			}
		}
	});

	it("returns true on first turn when TOBY_PRETREAT_FIRST_TURN=1", () => {
		const prev = process.env.TOBY_PRETREAT_FIRST_TURN;
		process.env.TOBY_PRETREAT_FIRST_TURN = "1";
		try {
			expect(shouldPretreat([], "hello world", true)).toBe(true);
		} finally {
			if (prev === undefined) {
				process.env.TOBY_PRETREAT_FIRST_TURN = undefined;
			} else {
				process.env.TOBY_PRETREAT_FIRST_TURN = prev;
			}
		}
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
		const prevFirstTurn = process.env.TOBY_PRETREAT_FIRST_TURN;
		process.env.TOBY_PRETREAT_FIRST_TURN = "1";
		// Pretreatment cache is only read when `globalThis.Bun` exists (see canUsePretreatmentCache).
		const g = globalThis as { Bun?: unknown };
		const prevBun = g.Bun;
		if (prevBun === undefined) {
			Object.defineProperty(g, "Bun", {
				value: {},
				configurable: true,
				writable: true,
			});
		}

		const getSpy = vi
			.spyOn(sessionStore, "getPretreatmentCache")
			.mockReturnValueOnce({
				goal: "Do a thing",
				mustDo: [],
				mustNotDo: [],
				assumptions: [],
				openQuestions: [],
				relevantIntegrations: [],
				relevantSkills: [],
			});
		const setSpy = vi.spyOn(sessionStore, "setPretreatmentCache");

		try {
			const r = await wrapUserPromptWithPretreatment({
				priorMessages: [],
				rawUserText: "Hello",
				integrationLabels: "",
				isFirstTurn: true,
			});

			expect(getSpy).toHaveBeenCalledTimes(1);
			expect(setSpy).not.toHaveBeenCalled();
			expect(r.content).toContain("User request (verbatim):");
			expect(r.content).toContain(JSON.stringify("Hello"));
		} finally {
			getSpy.mockRestore();
			setSpy.mockRestore();
			if (prevFirstTurn === undefined) {
				process.env.TOBY_PRETREAT_FIRST_TURN = undefined;
			} else {
				process.env.TOBY_PRETREAT_FIRST_TURN = prevFirstTurn;
			}
			if (prevBun === undefined) {
				delete (g as { Bun?: unknown }).Bun;
			}
		}
	});

	it("merges skill heuristic on cache hit when cached spec has empty relevantSkills", async () => {
		const prevFirstTurn = process.env.TOBY_PRETREAT_FIRST_TURN;
		process.env.TOBY_PRETREAT_FIRST_TURN = "1";
		const g = globalThis as { Bun?: unknown };
		const prevBun = g.Bun;
		if (prevBun === undefined) {
			Object.defineProperty(g, "Bun", {
				value: {},
				configurable: true,
				writable: true,
			});
		}

		const getSpy = vi
			.spyOn(sessionStore, "getPretreatmentCache")
			.mockReturnValueOnce({
				goal: "Summarize mail",
				mustDo: [],
				mustNotDo: [],
				assumptions: [],
				openQuestions: [],
				relevantIntegrations: [],
				relevantSkills: [],
			});
		const setSpy = vi.spyOn(sessionStore, "setPretreatmentCache");

		try {
			const r = await wrapUserPromptWithPretreatment({
				priorMessages: [],
				rawUserText: "Can you summarize my unread emails?",
				integrationLabels: "gmail",
				isFirstTurn: true,
				skillsCatalog: [
					{
						dirName: "check-unread-emails-summarize",
						name: "check-unread-emails-summarize",
						description:
							"Fetch unread messages from the user's Gmail and return a compact summary.",
						bodyMarkdown: "",
					},
				],
			});

			expect(setSpy).not.toHaveBeenCalled();
			expect(r.spec?.relevantSkills).toEqual(["check-unread-emails-summarize"]);
			expect(r.content).toContain("check-unread-emails-summarize");
			expect(r.content).toContain("Selected skills");
		} finally {
			getSpy.mockRestore();
			setSpy.mockRestore();
			if (prevFirstTurn === undefined) {
				process.env.TOBY_PRETREAT_FIRST_TURN = undefined;
			} else {
				process.env.TOBY_PRETREAT_FIRST_TURN = prevFirstTurn;
			}
			if (prevBun === undefined) {
				delete (g as { Bun?: unknown }).Bun;
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

describe("isFirstTurnPretreatmentEnabled", () => {
	it("reflects TOBY_PRETREAT_FIRST_TURN", () => {
		const prev = process.env.TOBY_PRETREAT_FIRST_TURN;
		process.env.TOBY_PRETREAT_FIRST_TURN = "1";
		try {
			expect(isFirstTurnPretreatmentEnabled()).toBe(true);
		} finally {
			if (prev === undefined) {
				process.env.TOBY_PRETREAT_FIRST_TURN = undefined;
			} else {
				process.env.TOBY_PRETREAT_FIRST_TURN = prev;
			}
		}
	});
});
