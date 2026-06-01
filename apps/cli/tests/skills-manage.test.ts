import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { updateSkillFrontmatter } from "../src/skills/manage";

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
