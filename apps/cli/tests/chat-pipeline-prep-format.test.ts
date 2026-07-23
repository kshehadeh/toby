import { describe, expect, it } from "bun:test";
import {
	createPrepId,
	formatPrepEndDetail,
} from "@toby/core/chat-pipeline/prep-format";

describe("formatPrepEndDetail", () => {
	it("returns Request prepared when content is unchanged", () => {
		expect(formatPrepEndDetail("hello", "hello", null)).toBe(
			"Request prepared.",
		);
	});

	it("returns intent message when pretreatment changed content", () => {
		expect(
			formatPrepEndDetail("hello", "hello\n\n[spec]", { goal: "x" } as never),
		).toBe("Intent specification attached to the model message.");
	});
});

describe("createPrepId", () => {
	it("returns null when pretreatment is skipped", () => {
		expect(createPrepId(false)).toBeNull();
	});

	it("returns a uuid when pretreatment runs", () => {
		expect(createPrepId(true)).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		);
	});
});
