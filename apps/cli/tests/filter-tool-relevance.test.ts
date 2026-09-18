import { describe, expect, it } from "bun:test";
import {
	ALWAYS_INCLUDED_TOOLS,
	PROJECT_GROUNDED_TOOLS,
	filterToolNamesByRelevance,
} from "@toby/core/chat-pipeline/run-turn";

describe("filterToolNamesByRelevance", () => {
	const all = [
		"askUser",
		"createLocalSkill",
		"enableTools",
		"fetchOpenTasks",
		"memorySearch",
		"webSearch",
		"writeTextFile",
		"listProjectFiles",
		"searchProjectFiles",
		"readProjectFile",
		"createProjectFolder",
		"renameProjectFile",
		"deleteProjectFile",
		"deleteProjectFolder",
	];

	it("passes all tools when pretreatment did not run", () => {
		expect(filterToolNamesByRelevance(all, undefined)).toEqual(all);
	});

	it("fail-closes to the discovery core when pretreatment selected no tools", () => {
		expect(filterToolNamesByRelevance(all, [])).toEqual([
			"askUser",
			"enableTools",
			"memorySearch",
		]);
	});

	it("includes createLocalSkill only when pretreatment selected it", () => {
		expect(filterToolNamesByRelevance(all, ["createLocalSkill"])).toEqual([
			"askUser",
			"createLocalSkill",
			"enableTools",
			"memorySearch",
		]);
	});

	it("keeps always-included tools when pretreatment narrowed integration tools", () => {
		expect(filterToolNamesByRelevance(all, ["fetchOpenTasks"])).toEqual([
			"askUser",
			"enableTools",
			"fetchOpenTasks",
			"memorySearch",
		]);
	});

	it("includes routed tools when pretreatment selected them", () => {
		expect(
			filterToolNamesByRelevance(all, ["fetchOpenTasks", "memorySearch"]),
		).toEqual(["askUser", "enableTools", "fetchOpenTasks", "memorySearch"]);
	});

	it("does not always include write, pdf, or project file tools outside project chats", () => {
		expect(ALWAYS_INCLUDED_TOOLS.has("writeTextFile")).toBe(false);
		expect(ALWAYS_INCLUDED_TOOLS.has("readPdf")).toBe(false);
		expect(ALWAYS_INCLUDED_TOOLS.has("createProjectFolder")).toBe(false);
		expect(ALWAYS_INCLUDED_TOOLS.has("deleteProjectFolder")).toBe(false);
		expect(ALWAYS_INCLUDED_TOOLS.has("listProjectFiles")).toBe(false);
	});

	it("always includes discovery and enableTools", () => {
		expect(ALWAYS_INCLUDED_TOOLS.has("enableTools")).toBe(true);
		expect(ALWAYS_INCLUDED_TOOLS.has("tobyListTools")).toBe(true);
		expect(ALWAYS_INCLUDED_TOOLS.has("delegateToSubAgent")).toBe(true);
		expect(ALWAYS_INCLUDED_TOOLS.has("memorySearch")).toBe(true);
	});

	it("keeps createLocalSkill explicit-only when no project is active", () => {
		expect(
			filterToolNamesByRelevance(all, ["fetchOpenTasks"], {
				projectActive: false,
			}),
		).toEqual(["askUser", "enableTools", "fetchOpenTasks", "memorySearch"]);
	});

	it("includes project file tools in the built-in set for project chats", () => {
		expect(PROJECT_GROUNDED_TOOLS).toEqual([
			"listProjectFiles",
			"searchProjectFiles",
			"readProjectFile",
			"writeTextFile",
			"createProjectFolder",
			"renameProjectFile",
			"deleteProjectFile",
			"deleteProjectFolder",
		]);
		expect(
			filterToolNamesByRelevance(all, ["fetchOpenTasks"], {
				projectActive: true,
			}),
		).toEqual([
			"askUser",
			"createLocalSkill",
			"enableTools",
			"fetchOpenTasks",
			"memorySearch",
			"writeTextFile",
			"listProjectFiles",
			"searchProjectFiles",
			"readProjectFile",
			"createProjectFolder",
			"renameProjectFile",
			"deleteProjectFile",
			"deleteProjectFolder",
		]);
	});

	it("fail-closes to discovery plus project file tools in project chats", () => {
		expect(
			filterToolNamesByRelevance(all, [], { projectActive: true }),
		).toEqual([
			"askUser",
			"createLocalSkill",
			"enableTools",
			"memorySearch",
			"writeTextFile",
			"listProjectFiles",
			"searchProjectFiles",
			"readProjectFile",
			"createProjectFolder",
			"renameProjectFile",
			"deleteProjectFile",
			"deleteProjectFolder",
		]);
	});
});
