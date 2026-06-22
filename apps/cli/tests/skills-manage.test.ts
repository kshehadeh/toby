import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	createSkill,
	updateSkillBody,
	updateSkillFrontmatter,
} from "@toby/core/skills/manage";
import { afterEach, describe, expect, it } from "vitest";

describe("updateSkillFrontmatter", () => {
	let tmp: string | undefined;

	afterEach(() => {
		if (tmp !== undefined && fs.existsSync(tmp)) {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
		tmp = undefined;
	});

	it("updates editable fields and keeps body content", () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "toby-skill-manage-"));
		const skillDir = path.join(tmp, "demo-skill");
		fs.mkdirSync(skillDir, { recursive: true });
		const skillPath = path.join(skillDir, "SKILL.md");
		fs.writeFileSync(
			skillPath,
			`---
name: demo-skill
description: Initial description.
summary: Old summary.
---

## Body

Keep this body.
`,
			"utf-8",
		);

		updateSkillFrontmatter(
			"demo-skill",
			{
				name: "renamed-skill",
				description: "Updated description.",
				summary: "New summary.",
			},
			tmp,
		);

		const next = fs.readFileSync(skillPath, "utf-8");
		expect(next).toContain("name: renamed-skill");
		expect(next).toContain("description: Updated description.");
		expect(next).toContain("summary: New summary.");
		expect(next).toContain("## Body");
		expect(next).toContain("Keep this body.");
	});

	it("removes summary line when summary is cleared", () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "toby-skill-manage-"));
		const skillDir = path.join(tmp, "demo-skill");
		fs.mkdirSync(skillDir, { recursive: true });
		const skillPath = path.join(skillDir, "SKILL.md");
		fs.writeFileSync(
			skillPath,
			`---
name: demo-skill
description: Initial description.
summary: To remove.
---

Body.
`,
			"utf-8",
		);

		updateSkillFrontmatter("demo-skill", { summary: "   " }, tmp);
		const next = fs.readFileSync(skillPath, "utf-8");
		expect(next).not.toContain("summary:");
		expect(next).toContain("description: Initial description.");
	});
});

describe("createSkill", () => {
	let tmp: string | undefined;

	afterEach(() => {
		if (tmp !== undefined && fs.existsSync(tmp)) {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
		tmp = undefined;
	});

	it("creates a new skill directory with a default SKILL.md", () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "toby-skill-create-"));
		const { dirName } = createSkill(tmp);

		expect(fs.existsSync(path.join(tmp, dirName, "SKILL.md"))).toBe(true);
		const content = fs.readFileSync(
			path.join(tmp, dirName, "SKILL.md"),
			"utf-8",
		);
		expect(content).toContain("name: New Skill");
		expect(content).toContain("description: Describe what this skill does.");
	});

	it("picks a unique folder name when new-skill already exists", () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "toby-skill-create-"));
		fs.mkdirSync(path.join(tmp, "new-skill"), { recursive: true });

		const { dirName } = createSkill(tmp);
		expect(dirName).not.toBe("new-skill");
		expect(dirName.startsWith("new-skill")).toBe(true);
	});
});

describe("updateSkillBody", () => {
	let tmp: string | undefined;

	afterEach(() => {
		if (tmp !== undefined && fs.existsSync(tmp)) {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
		tmp = undefined;
	});

	it("updates the body while keeping the frontmatter intact", () => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "toby-skill-body-"));
		const skillDir = path.join(tmp, "demo-skill");
		fs.mkdirSync(skillDir, { recursive: true });
		const skillPath = path.join(skillDir, "SKILL.md");
		fs.writeFileSync(
			skillPath,
			`---
name: demo-skill
description: Initial description.
---

Old body.
`,
			"utf-8",
		);

		updateSkillBody("demo-skill", "New body content.", tmp);
		const next = fs.readFileSync(skillPath, "utf-8");
		expect(next).toContain("name: demo-skill");
		expect(next).toContain("description: Initial description.");
		expect(next).toContain("New body content.");
		expect(next).not.toContain("Old body.");
	});
});
