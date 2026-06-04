import type { CoreMessage } from "@toby/core/ai/chat";
import type { UserIntentSpec } from "@toby/core/ai/pretreatment";
import {
	isDeltaPretreatmentEnabled,
	isFirstTurnPretreatmentEnabled,
	isPretreatmentDisabled,
	isTrivialFollowUp,
	shouldPretreat,
	wrapUserPromptWithPretreatment,
} from "@toby/core/ai/pretreatment";
import * as sessionStore from "@toby/core/session-store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateTextMock } = vi.hoisted(() => ({
	generateTextMock: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("ai")>();
	return {
		...actual,
		generateText: (...args: unknown[]) => generateTextMock(...args),
	};
});

function minimalSpec(over: Partial<UserIntentSpec> = {}): UserIntentSpec {
	return {
		goal: "Prior goal",
		mustDo: [],
		mustNotDo: [],
		assumptions: [],
		openQuestions: [],
		relevantIntegrations: ["Todoist"],
		relevantSkills: [],
		relevantTools: ["todoistListTasks"],
		sessionName: "Task List",
		...over,
	};
}

describe("isTrivialFollowUp", () => {
	it("matches short acknowledgements", () => {
		expect(isTrivialFollowUp("ok")).toBe(true);
		expect(isTrivialFollowUp("Yes.")).toBe(true);
		expect(isTrivialFollowUp("go ahead")).toBe(true);
	});

	it("rejects long or substantive follow-ups", () => {
		expect(isTrivialFollowUp("also archive the other thread")).toBe(false);
		expect(isTrivialFollowUp("")).toBe(false);
	});
});

describe("isDeltaPretreatmentEnabled", () => {
	it("is enabled by default", () => {
		const prev = process.env.TOBY_PRETREAT_DELTA;
		process.env.TOBY_PRETREAT_DELTA = undefined;
		try {
			expect(isDeltaPretreatmentEnabled()).toBe(true);
		} finally {
			if (prev === undefined) {
				process.env.TOBY_PRETREAT_DELTA = undefined;
			} else {
				process.env.TOBY_PRETREAT_DELTA = prev;
			}
		}
	});

	it("can be disabled with TOBY_PRETREAT_DELTA=0", () => {
		const prev = process.env.TOBY_PRETREAT_DELTA;
		process.env.TOBY_PRETREAT_DELTA = "0";
		try {
			expect(isDeltaPretreatmentEnabled()).toBe(false);
		} finally {
			if (prev === undefined) {
				process.env.TOBY_PRETREAT_DELTA = undefined;
			} else {
				process.env.TOBY_PRETREAT_DELTA = prev;
			}
		}
	});
});

describe("shouldPretreat", () => {
	it("returns true on the first turn for any non-empty prompt", () => {
		expect(shouldPretreat([], "hello world", true)).toBe(true);
	});

	it("returns false for blank prompts", () => {
		expect(shouldPretreat([], "  ", true)).toBe(false);
		expect(shouldPretreat([], "", false)).toBe(false);
	});

	it("returns false when pretreatment is disabled", () => {
		const prev = process.env.TOBY_DISABLE_PRETREATMENT;
		process.env.TOBY_DISABLE_PRETREATMENT = "1";
		try {
			expect(shouldPretreat([], "hello", true)).toBe(false);
			expect(shouldPretreat([], "hello", false)).toBe(false);
		} finally {
			if (prev === undefined) {
				process.env.TOBY_DISABLE_PRETREATMENT = undefined;
			} else {
				process.env.TOBY_DISABLE_PRETREATMENT = prev;
			}
		}
	});

	it("returns true on later turns even for long, unambiguous prompts", () => {
		const long =
			"Please list my open Todoist tasks sorted by due date and exclude completed items.";
		expect(shouldPretreat([], long, false)).toBe(true);
	});

	it("returns true on later turn for very short follow-ups", () => {
		expect(shouldPretreat([], "ok", false)).toBe(true);
	});

	it("returns true for pronoun-heavy text regardless of conversation state", () => {
		const msgs: CoreMessage[] = [
			{ role: "user", content: "first" },
			{ role: "assistant", content: "done" },
			{ role: "user", content: "second" },
			{ role: "assistant", content: "ok" },
		];
		expect(shouldPretreat(msgs, "Do the same for that one", false)).toBe(true);
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
	beforeEach(() => {
		generateTextMock.mockReset();
	});

	it("reuses prior spec for trivial follow-ups without calling the model", async () => {
		const prior = {
			rawUserText: "List my open tasks",
			spec: minimalSpec(),
		};
		const r = await wrapUserPromptWithPretreatment({
			priorMessages: [{ role: "user", content: "prior" }],
			rawUserText: "ok",
			integrationLabels: "Todoist",
			isFirstTurn: false,
			priorPretreatment: prior,
		});
		expect(generateTextMock).not.toHaveBeenCalled();
		expect(r.spec?.relevantTools).toEqual(["todoistListTasks"]);
		expect(r.spec?.goal).toContain("Prior goal");
		expect(r.spec?.goal).toContain("ok");
	});

	it("uses delta pretreatment when scope is unchanged", async () => {
		generateTextMock.mockResolvedValueOnce({
			output: { reusePriorSelection: true, goal: "Continue listing tasks" },
		});
		const prior = {
			rawUserText: "List my open tasks",
			spec: minimalSpec(),
		};
		const r = await wrapUserPromptWithPretreatment({
			priorMessages: [{ role: "user", content: "prior" }],
			rawUserText: "same but only overdue",
			integrationLabels: "Todoist",
			isFirstTurn: false,
			priorPretreatment: prior,
		});
		expect(generateTextMock).toHaveBeenCalledTimes(1);
		expect(r.spec?.goal).toBe("Continue listing tasks");
		expect(r.spec?.relevantTools).toEqual(["todoistListTasks"]);
	});

	it("runs full pretreatment when delta reports a scope change", async () => {
		generateTextMock
			.mockResolvedValueOnce({
				output: { reusePriorSelection: false },
			})
			.mockResolvedValueOnce({
				output: {
					goal: "Search Gmail",
					mustDo: [],
					mustNotDo: [],
					assumptions: [],
					openQuestions: [],
					relevantIntegrations: ["Gmail"],
					relevantSkills: [],
					relevantTools: ["gmailSearch"],
					sessionName: "",
				},
			});
		const prior = {
			rawUserText: "List my open tasks",
			spec: minimalSpec(),
		};
		const r = await wrapUserPromptWithPretreatment({
			priorMessages: [{ role: "user", content: "prior" }],
			rawUserText: "search my inbox for invoices instead",
			integrationLabels: "Gmail + Todoist",
			isFirstTurn: false,
			priorPretreatment: prior,
			toolsCatalogText: "- gmailSearch: Search mail",
			allowedToolNamesLower: new Set(["gmailsearch"]),
		});
		expect(generateTextMock).toHaveBeenCalledTimes(2);
		expect(r.spec?.goal).toBe("Search Gmail");
		expect(r.spec?.relevantTools).toEqual(["gmailSearch"]);
	});

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
				relevantTools: [],
				sessionName: "",
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
				Reflect.deleteProperty(g, "Bun");
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
				relevantTools: [],
				sessionName: "",
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
				Reflect.deleteProperty(g, "Bun");
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
