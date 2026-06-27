import { describe, expect, it } from "bun:test";

describe("runtime verification", () => {
	it("runs under Bun", () => {
		expect(typeof Bun).toBe("object");
		expect(typeof Bun.version).toBe("string");
	});

	it("can import bun:sqlite", () => {
		expect(() => {
			// biome-ignore lint/suspicious/noExplicitAny: runtime probe
			require("bun:sqlite" as any);
		}).not.toThrow();
	});
});
