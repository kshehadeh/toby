import { describe, expect, it } from "bun:test";
import { stripLoneSurrogates } from "@toby/core/lone-surrogates";
import { deserializeTranscriptRow } from "@toby/core/transcript-persist";

describe("stripLoneSurrogates", () => {
	it("removes a trailing lone high surrogate from a split emoji", () => {
		// "🟢" is U+1F7E2 -> surrogate pair \uD83D\uDFE2
		const split = "EPIC 1: \uD83D";
		expect(stripLoneSurrogates(split)).toBe("EPIC 1: ");
	});

	it("preserves valid surrogate pairs", () => {
		const value = "done \uD83D\uDFE2 ok";
		expect(stripLoneSurrogates(value)).toBe(value);
	});

	it("drops lone low surrogates", () => {
		expect(stripLoneSurrogates("\uDFE2tail")).toBe("tail");
	});
});

describe("deserializeTranscriptRow surrogate healing", () => {
	it("strips lone surrogates from a boxed_step body so output is valid JSON", () => {
		const row = {
			kind: "boxed_step",
			text: JSON.stringify({
				id: "abc",
				seq: 1,
				variant: "assistant",
				header: "Summary",
				body: "EPIC 1: \uD83D",
			}),
		};
		const entry = deserializeTranscriptRow(row);
		expect(entry.kind).toBe("boxed_step");
		if (entry.kind === "boxed_step") {
			expect(entry.body).toBe("EPIC 1: ");
		}
		// The full entry must serialize to well-formed JSON (no lone surrogates).
		expect(
			JSON.stringify(entry).match(
				/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
			),
		).toBeNull();
	});
});
