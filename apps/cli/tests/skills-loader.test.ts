import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	collectToolsForSelectedSkills,
	computeSkillCatalogSignature,
	formatSkillsCatalogForPrompt,
	loadLocalSkills,
	parseSkillFileContent,
	parseSkillFrontmatterAndBody,
	resolveSkillsByNames,
} from "@toby/core/skills/index";
import { afterEach, describe, expect, it } from "bun:test";

describe("parseSkillFrontmatterAndBody", () => {
	it("parses standard SKILL.md shape", () => {
		const raw = `---
name: demo-skill
description: One line description.
---

# Hello

Body here.
`;
		const parsed = parseSkillFrontmatterAndBody(raw);
		expect(parsed?.frontmatter.name).toBe("demo-skill");
		expect(parsed?.frontmatter.description).toBe("One line description.");
		expect(parsed?.body).toContain("# Hello");
	});

	it("returns null without fenced frontmatter", () => {
		expect(parseSkillFrontmatterAndBody("no frontmatter")).toBeNull();
	});
});

describe("parseSkillFileContent", () => {
	it("returns null when name or description missing", () => {
		expect(
			parseSkillFileContent(
				"x",
				`---
name: only-name
---
`,
			),
		).toBeNull();
	});

	it("ignores legacy summary frontmatter", () => {
		const raw = `---
name: demo-skill
description: One line description.
summary: Concise summary of key instructions.
---

# Hello

Body here.
`;
		const skill = parseSkillFileContent("demo-skill", raw);
		expect(skill).not.toBeNull();
		expect("summary" in (skill ?? {})).toBe(false);
	});

	it("parses comma-separated tools and integrations frontmatter", () => {
		const raw = `---
name: demo-skill
description: One line description.
tools: searchEmails, listLabels , searchEmails
integrations: Gmail, Todoist
---

Body.
`;
		const skill = parseSkillFileContent("demo-skill", raw);
		expect(skill?.tools).toEqual(["searchEmails", "listLabels"]);
		expect(skill?.integrations).toEqual(["Gmail", "Todoist"]);
	});

	it("parses YAML-ish bulleted tools list", () => {
		const raw = `---
name: demo-skill
description: One line description.
tools:
  - searchEmails
  - createDraft
---

Body.
`;
		const skill = parseSkillFileContent("demo-skill", raw);
		expect(skill?.tools).toEqual(["searchEmails", "createDraft"]);
	});

	it("defaults tools and integrations to empty arrays when absent", () => {
		const raw = `---
name: demo-skill
description: One line description.
---

Body.
`;
		const skill = parseSkillFileContent("demo-skill", raw);
		expect(skill?.tools).toEqual([]);
		expect(skill?.integrations).toEqual([]);
	});
});

describe("collectToolsForSelectedSkills", () => {
	const skills = [
		{
			dirName: "organize",
			name: "organize-email",
			description: "Organize the inbox.",
			bodyMarkdown: "",
			tools: ["searchEmails", "listLabels", "notARealTool"],
			integrations: ["Todoist"],
		},
		{
			dirName: "other",
			name: "other-skill",
			description: "Unrelated.",
			bodyMarkdown: "",
			tools: ["macWifiStatus"],
			integrations: [],
		},
	];
	const toolIntegrationLabels: Record<string, string> = {
		searchEmails: "Gmail",
		listLabels: "Gmail",
		macWifiStatus: "macOS",
		fetchOpenTasks: "Todoist",
		createTask: "Todoist",
	};
	const allowedToolNamesLower = new Set(
		Object.keys(toolIntegrationLabels).map((n) => n.toLowerCase()),
	);

	it("expands explicit tools and integration tools for selected skills, dropping unknown tools", () => {
		const result = collectToolsForSelectedSkills({
			selectedSkillNames: ["organize-email"],
			skills,
			allowedToolNamesLower,
			toolIntegrationLabels,
		});
		expect(result).toEqual([
			"searchEmails",
			"listLabels",
			"fetchOpenTasks",
			"createTask",
		]);
	});

	it("returns empty when no selected skill matches", () => {
		expect(
			collectToolsForSelectedSkills({
				selectedSkillNames: ["missing"],
				skills,
				allowedToolNamesLower,
				toolIntegrationLabels,
			}),
		).toEqual([]);
	});

	it("matches integration labels case-insensitively", () => {
		const result = collectToolsForSelectedSkills({
			selectedSkillNames: ["other-skill"],
			skills,
			allowedToolNamesLower,
			toolIntegrationLabels,
		});
		expect(result).toEqual(["macWifiStatus"]);
	});
});

describe("loadLocalSkills", () => {
	let tmp: string | undefined;

	afterEach(() => {
		if (tmp !== undefined && fs.existsSync(tmp)) {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
		tmp = undefined;
	});

	it("loads valid skill directories and skips invalid ones", () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "toby-skills-"));
		const good = path.join(tmp, "good-skill");
		fs.mkdirSync(good, { recursive: true });
		fs.writeFileSync(
			path.join(good, "SKILL.md"),
			`---
name: good-skill
description: Does good things.
---

## Steps
Run tests.
`,
			"utf-8",
		);
		const bad = path.join(tmp, "bad-skill");
		fs.mkdirSync(bad, { recursive: true });
		fs.writeFileSync(path.join(bad, "SKILL.md"), "# No frontmatter\n", "utf-8");

		const skills = loadLocalSkills(tmp);
		expect(skills).toHaveLength(1);
		expect(skills[0]?.name).toBe("good-skill");
		expect(skills[0]?.bodyMarkdown).toContain("Steps");
	});
});

describe("computeSkillCatalogSignature", () => {
	it("changes when skill descriptions change", () => {
		const a = [
			{
				name: "x",
				description: "one",
				bodyMarkdown: "",
				dirName: "x",
			},
		];
		const b = [
			{
				name: "x",
				description: "two",
				bodyMarkdown: "",
				dirName: "x",
			},
		];
		expect(computeSkillCatalogSignature(a)).not.toBe(
			computeSkillCatalogSignature(b),
		);
	});

	it("changes when skill names change", () => {
		const a = [
			{
				name: "x",
				description: "same",
				bodyMarkdown: "",
				dirName: "x",
			},
		];
		const b = [
			{
				name: "y",
				description: "same",
				bodyMarkdown: "",
				dirName: "x",
			},
		];
		expect(computeSkillCatalogSignature(a)).not.toBe(
			computeSkillCatalogSignature(b),
		);
	});
});

describe("resolveSkillsByNames", () => {
	it("matches case-insensitively and preserves skill order from names array", () => {
		const skills = [
			{
				dirName: "a",
				name: "Alpha",
				description: "d",
				bodyMarkdown: "ba",
			},
			{
				dirName: "b",
				name: "Beta",
				description: "d2",
				bodyMarkdown: "bb",
			},
		];
		const resolved = resolveSkillsByNames(skills, ["beta", "ALPHA"]);
		expect(resolved.map((s) => s.name)).toEqual(["Beta", "Alpha"]);
	});
});

describe("formatSkillsCatalogForPrompt", () => {
	it("formats names and descriptions", () => {
		const skills = [
			{
				dirName: "a",
				name: "my-skill",
				description: "Does things.",
				bodyMarkdown: "",
			},
		];
		const catalog = formatSkillsCatalogForPrompt(skills);
		expect(catalog).toBe("- my-skill: Does things.");
	});

	it("returns (none) for empty list", () => {
		expect(formatSkillsCatalogForPrompt([])).toBe("(none)");
	});
});
