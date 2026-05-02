import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	computeSkillCatalogSignature,
	loadLocalSkills,
	parseSkillFileContent,
	parseSkillFrontmatterAndBody,
	resolveSkillsByNames,
} from "../src/skills/index";

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
			{ name: "x", description: "one", bodyMarkdown: "", dirName: "x" },
		];
		const b = [
			{ name: "x", description: "two", bodyMarkdown: "", dirName: "x" },
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
