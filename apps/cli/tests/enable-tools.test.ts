import { describe, expect, it } from "bun:test";
import {
	collectEnabledToolNamesFromCalls,
	collectEnabledToolNamesFromSteps,
	createEnableToolsTool,
	partitionEnableToolsNames,
	unionToolNames,
} from "@toby/core/ai/enable-tools-tool";

describe("unionToolNames", () => {
	it("appends new names and de-duplicates case-insensitively", () => {
		expect(
			unionToolNames(["gmailSearch"], ["todoistListTasks", "GmailSearch"]),
		).toEqual(["gmailSearch", "todoistListTasks"]);
	});
});

describe("partitionEnableToolsNames", () => {
	const canonical = new Map([
		["gmailsearch", "gmailSearch"],
		["createlocalskill", "createLocalSkill"],
	]);
	const allowed = new Set(canonical.keys());
	const blocked = new Set(["createlocalskill"]);

	it("splits enabled, unknown, and blocked names", () => {
		expect(
			partitionEnableToolsNames(
				["gmailSearch", "nope", "createLocalSkill"],
				allowed,
				blocked,
				canonical,
			),
		).toEqual({
			enabled: ["gmailSearch"],
			unknown: ["nope"],
			blocked: ["createLocalSkill"],
		});
	});
});

describe("collectEnabledToolNamesFromSteps", () => {
	it("reads enableTools calls from previous steps", () => {
		const canonical = new Map([["gmailsearch", "gmailSearch"]]);
		expect(
			collectEnabledToolNamesFromSteps(
				[
					{
						toolCalls: [
							{
								toolName: "enableTools",
								input: { names: ["gmailSearch"] },
							},
						],
					},
				],
				new Set(["gmailsearch"]),
				new Set(),
				canonical,
			),
		).toEqual(["gmailSearch"]);
	});
});

describe("collectEnabledToolNamesFromCalls", () => {
	it("reads enableTools from normalized tool call records", () => {
		const canonical = new Map([["websearch", "webSearch"]]);
		expect(
			collectEnabledToolNamesFromCalls(
				[{ name: "enableTools", args: { names: ["webSearch"] } }],
				new Set(["websearch"]),
				new Set(),
				canonical,
			),
		).toEqual(["webSearch"]);
	});
});

describe("createEnableToolsTool", () => {
	it("enables catalog tools and rejects blocked names", async () => {
		const t = createEnableToolsTool({
			allowedToolNames: ["gmailSearch", "createLocalSkill"],
			blockedToolNames: ["createLocalSkill"],
		});
		const execute = t.execute as (input: {
			names: string[];
		}) => Promise<{
			ok: boolean;
			enabled: string[];
			unknown: string[];
			blocked: string[];
		}>;
		const result = await execute({
			names: ["gmailSearch", "createLocalSkill", "missing"],
		});
		expect(result.ok).toBe(true);
		expect(result.enabled).toEqual(["gmailSearch"]);
		expect(result.blocked).toEqual(["createLocalSkill"]);
		expect(result.unknown).toEqual(["missing"]);
	});
});
