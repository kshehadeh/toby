import { describe, expect, it } from "bun:test";
import {
	deliverFlowDestinations,
	destinationDeliveryFailed,
} from "@toby/core/flows";

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

	it("does not treat a failed dashboard delivery as a run failure", async () => {
		const failed = destinationDeliveryFailed([
			{ type: "dashboard", ok: false, error: "unused" },
			{ type: "modal", ok: false, error: "unused" },
			{ type: "email", ok: false, error: "send failed" },
		]);
		expect(failed).toEqual([
			{ type: "email", ok: false, error: "send failed" },
		]);
	});

	it("records dashboard as ok without calling a tool", async () => {
		const results = await deliverFlowDestinations({
			destinations: [{ type: "dashboard", variant: "informational" }],
			result: {
				text: "Hello",
				format: "plain",
				pointer: { from: "result" },
			},
		});
		expect(results).toEqual([{ type: "dashboard", ok: true }]);
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
