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
		// askUser and memorySearch are always-included, createLocalSkill is explicitly selected.
		// webSearch is no longer always-included, so it is dropped.
		expect(filterToolNamesByRelevance(all, ["createLocalSkill"])).toEqual([
			"askUser",
			"createLocalSkill",
			"memorySearch",
		]);
	});

	it("keeps always-included tools when pretreatment narrowed integration tools", () => {
		// askUser + memorySearch (always-included) + fetchOpenTasks (relevant) remain.
		// webSearch is no longer always-included.
		expect(filterToolNamesByRelevance(all, ["fetchOpenTasks"])).toEqual([
			"askUser",
			"fetchOpenTasks",
			"memorySearch",
		]);
	});

	it("includes routed tools when pretreatment selected them", () => {
		expect(
			filterToolNamesByRelevance(all, ["fetchOpenTasks", "memorySearch"]),
		).toEqual(["askUser", "fetchOpenTasks", "memorySearch"]);
	});
});
