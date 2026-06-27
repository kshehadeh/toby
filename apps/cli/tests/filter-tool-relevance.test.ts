import { filterToolNamesByRelevance } from "@toby/core/chat-pipeline/run-turn";
import { describe, expect, it } from "bun:test";

describe("filterToolNamesByRelevance", () => {
	const all = [
		"askUser",
		"createLocalSkill",
		"fetchOpenTasks",
		"memorySearch",
		"webSearch",
	];

	it("passes all tools when pretreatment did not run", () => {
		expect(filterToolNamesByRelevance(all, undefined)).toEqual(all);
	});

	it("drops createLocalSkill when pretreatment ran but selected no tools", () => {
		// Empty relevantTools keeps all tools except explicit-request-only ones.
		expect(filterToolNamesByRelevance(all, [])).toEqual([
			"askUser",
			"fetchOpenTasks",
			"memorySearch",
			"webSearch",
		]);
	});

	it("includes createLocalSkill only when pretreatment selected it", () => {
		// askUser is always-included, createLocalSkill is explicitly selected.
		// memorySearch and webSearch are no longer always-included, so they are dropped.
		expect(filterToolNamesByRelevance(all, ["createLocalSkill"])).toEqual([
			"askUser",
			"createLocalSkill",
		]);
	});

	it("keeps always-included tools when pretreatment narrowed integration tools", () => {
		// Only askUser (always-included) + fetchOpenTasks (relevant) remain.
		// memorySearch and webSearch are no longer always-included.
		expect(filterToolNamesByRelevance(all, ["fetchOpenTasks"])).toEqual([
			"askUser",
			"fetchOpenTasks",
		]);
	});

	it("includes routed tools when pretreatment selected them", () => {
		expect(
			filterToolNamesByRelevance(all, ["fetchOpenTasks", "memorySearch"]),
		).toEqual(["askUser", "fetchOpenTasks", "memorySearch"]);
	});
});
