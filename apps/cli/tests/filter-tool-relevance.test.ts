import { filterToolNamesByRelevance } from "@toby/core/chat-pipeline/run-turn";
import { describe, expect, it } from "vitest";

describe("filterToolNamesByRelevance", () => {
	const all = ["askUser", "createLocalSkill", "fetchOpenTasks", "memorySearch"];

	it("passes all tools when pretreatment did not run", () => {
		expect(filterToolNamesByRelevance(all, undefined)).toEqual(all);
	});

	it("drops createLocalSkill when pretreatment ran but selected no tools", () => {
		expect(filterToolNamesByRelevance(all, [])).toEqual([
			"askUser",
			"fetchOpenTasks",
			"memorySearch",
		]);
	});

	it("includes createLocalSkill only when pretreatment selected it", () => {
		expect(filterToolNamesByRelevance(all, ["createLocalSkill"])).toEqual([
			"askUser",
			"createLocalSkill",
			"memorySearch",
		]);
	});

	it("keeps always-included tools when pretreatment narrowed integration tools", () => {
		expect(filterToolNamesByRelevance(all, ["fetchOpenTasks"])).toEqual([
			"askUser",
			"fetchOpenTasks",
			"memorySearch",
		]);
	});
});
