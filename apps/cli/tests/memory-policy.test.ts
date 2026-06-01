import { describe, expect, it } from "vitest";
import {
	classifySensitivity,
	detectExplicitStatement,
	shouldAutoSave,
	suggestVisibility,
} from "../src/memory/policy";
import type { MemoryCandidate, MemoryProposal } from "../src/memory/types";

function makeCandidate(
	overrides: Partial<MemoryCandidate> = {},
): MemoryCandidate {
	return {
		userId: "user1",
		type: "preference",
		subject: undefined,
		value: "I like dark mode",
		confidence: 0.9,
		sensitivity: "normal",
		visibility: "usable_by_ai",
		expiresAt: null,
		...overrides,
	};
}

function makeProposal(overrides: Partial<MemoryProposal> = {}): MemoryProposal {
	return {
		id: "proposal-1",
		userId: "user1",
		status: "pending",
		candidate: makeCandidate(),
		sourceId: "source-1",
		confidence: 0.9,
		sensitivity: "normal",
		suggestedVisibility: "usable_by_ai",
		reason: "test",
		createdAt: new Date().toISOString(),
		...overrides,
	};
}

describe("memory-policy", () => {
	describe("classifySensitivity", () => {
		it("classifies normal text as normal", () => {
			expect(
				classifySensitivity(makeCandidate({ value: "I prefer dark mode" })),
			).toBe("normal");
		});

		it("classifies health-related content as restricted", () => {
			expect(
				classifySensitivity(
					makeCandidate({ value: "Taking medication for anxiety" }),
				),
			).toBe("restricted");
		});

		it("classifies political content as restricted", () => {
			expect(
				classifySensitivity(
					makeCandidate({ value: "Voted for democrat candidates" }),
				),
			).toBe("restricted");
		});

		it("classifies religion content as restricted", () => {
			expect(
				classifySensitivity(
					makeCandidate({ value: "Attends church every Sunday" }),
				),
			).toBe("restricted");
		});

		it("classifies sexuality content as restricted", () => {
			expect(
				classifySensitivity(
					makeCandidate({ value: "Came out about sexual orientation" }),
				),
			).toBe("restricted");
		});

		it("classifies financial content as restricted", () => {
			expect(
				classifySensitivity(
					makeCandidate({ value: "Salary is 120k per year" }),
				),
			).toBe("restricted");
		});

		it("classifies location content as restricted", () => {
			expect(
				classifySensitivity(
					makeCandidate({ value: "My home address is 123 Main St" }),
				),
			).toBe("restricted");
		});

		it("classifies personal/private content as sensitive", () => {
			expect(
				classifySensitivity(
					makeCandidate({ value: "Shared a personal secret" }),
				),
			).toBe("sensitive");
		});

		it("checks subject field too", () => {
			expect(
				classifySensitivity(
					makeCandidate({
						value: "discussed this",
						subject: "mental health treatment",
					}),
				),
			).toBe("restricted");
		});
	});

	describe("shouldAutoSave", () => {
		it("auto-saves normal high-confidence preferences", () => {
			const proposal = makeProposal({
				sensitivity: "normal",
				confidence: 0.9,
				candidate: makeCandidate({ type: "preference", confidence: 0.9 }),
			});
			expect(shouldAutoSave(proposal)).toBe(true);
		});

		it("does not auto-save sensitive content", () => {
			const proposal = makeProposal({
				sensitivity: "sensitive",
				confidence: 0.9,
				candidate: makeCandidate({ type: "preference", confidence: 0.9 }),
			});
			expect(shouldAutoSave(proposal)).toBe(false);
		});

		it("does not auto-save restricted content", () => {
			const proposal = makeProposal({
				sensitivity: "restricted",
				confidence: 0.9,
				candidate: makeCandidate({ type: "preference", confidence: 0.9 }),
			});
			expect(shouldAutoSave(proposal)).toBe(false);
		});

		it("does not auto-save low-confidence preferences", () => {
			const proposal = makeProposal({
				sensitivity: "normal",
				confidence: 0.6,
				candidate: makeCandidate({ type: "preference", confidence: 0.6 }),
			});
			expect(shouldAutoSave(proposal)).toBe(false);
		});

		it("auto-saves very high-confidence facts", () => {
			const proposal = makeProposal({
				sensitivity: "normal",
				confidence: 0.95,
				candidate: makeCandidate({ type: "fact", confidence: 0.95 }),
			});
			expect(shouldAutoSave(proposal)).toBe(true);
		});

		it("does not auto-save relationships", () => {
			const proposal = makeProposal({
				sensitivity: "normal",
				confidence: 0.95,
				candidate: makeCandidate({ type: "relationship", confidence: 0.95 }),
			});
			expect(shouldAutoSave(proposal)).toBe(false);
		});
	});

	describe("suggestVisibility", () => {
		it("restricted sensitivity requires confirmation", () => {
			expect(suggestVisibility("restricted", "fact", false)).toBe(
				"requires_confirmation",
			);
		});

		it("sensitive sensitivity requires confirmation", () => {
			expect(suggestVisibility("sensitive", "fact", false)).toBe(
				"requires_confirmation",
			);
		});

		it("relationship type requires confirmation unless explicitly stated", () => {
			expect(suggestVisibility("normal", "relationship", false)).toBe(
				"requires_confirmation",
			);
			expect(suggestVisibility("normal", "relationship", true)).toBe(
				"usable_by_ai",
			);
		});

		it("normal preference is usable by AI", () => {
			expect(suggestVisibility("normal", "preference", false)).toBe(
				"usable_by_ai",
			);
		});
	});

	describe("detectExplicitStatement", () => {
		it("detects 'I prefer'", () => {
			expect(detectExplicitStatement("I prefer dark mode")).toBe(true);
		});

		it("detects 'please remember'", () => {
			expect(detectExplicitStatement("Please remember this")).toBe(true);
		});

		it("detects 'I am'", () => {
			expect(detectExplicitStatement("I am a software engineer")).toBe(true);
		});

		it("does not flag implicit statements", () => {
			expect(detectExplicitStatement("The user likes coffee")).toBe(false);
		});

		it("detects 'don't forget'", () => {
			expect(detectExplicitStatement("Don't forget my birthday")).toBe(true);
		});
	});
});
