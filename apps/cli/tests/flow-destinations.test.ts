import { describe, expect, it } from "bun:test";
import { deliverFlowDestinations } from "@toby/core/flows";

describe("deliverFlowDestinations", () => {
	it("records modal as ok without calling a tool", async () => {
		const results = await deliverFlowDestinations({
			destinations: [{ type: "modal" }],
			result: {
				text: "Hello",
				format: "plain",
				pointer: { from: "result" },
			},
		});
		expect(results).toEqual([{ type: "modal", ok: true }]);
	});

	it("fails email/slack when the result text is empty", async () => {
		const results = await deliverFlowDestinations({
			destinations: [
				{
					type: "email",
					to: ["me@example.com"],
					subject: "Hi",
				},
				{ type: "slack", channel: "#ops" },
			],
			result: { text: "   ", format: "plain", pointer: { from: "result" } },
		});
		expect(results.every((item) => !item.ok)).toBe(true);
		expect(results[0]?.error).toMatch(/empty result/);
	});
});
